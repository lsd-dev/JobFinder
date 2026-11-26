import type { CollectionReference, DocumentReference, Firestore } from "firebase-admin/firestore";
import type { Company, StoredJob } from "../types.js";
import type { Profile, Settings } from "../config/profile.js";
import { sanitizeSettings } from "../config/profile.js";
import { safeId } from "../text.js";
import type { CompanyHealth, CompanyState, NotifyField, Store } from "./types.js";

/** Firestore error code for "document already exists" (gRPC ALREADY_EXISTS). */
const ALREADY_EXISTS = 6;
const BATCH = 400;
/** Cap on remembered open matched jobs per company (only paged sources ever grow). */
const OPEN_CAP = 500;
const NOTIFY_FIELDS: NotifyField[] = ["foundNotifiedAt", "peakRemindedAt", "followUpRemindedAt"];

interface StateDoc {
  seen: string[];
  initialized: boolean;
  /** External ids of stored jobs not yet marked closed. Lets markClosed skip its query on most runs. */
  openMatched: string[];
  consecutiveFailures: number;
}

interface Cached {
  open: Set<string>;
  consecutiveFailures: number;
  /** Serialized state as last read/written, to skip unchanged writes. */
  fingerprint: string;
}

/**
 * Firestore-backed Store. Everything lives under /spaces/{spaceKey}:
 *
 *   jobs/{id}         matched jobs (dashboard reads these, edits status/notes)
 *   companies/{id}    watchlist
 *   health/{id}       last scan result per company (dashboard reads)
 *   state/{id}        seen ids + open matched ids (scanner only)
 *   config/profile, config/settings
 *   devices/{token}   push tokens
 *   meta/scanner      housekeeping
 *
 * Designed for the Spark plan's daily quota: a normal run costs about one read
 * and one write per company plus three small queries. All dates are ISO-8601
 * strings (they sort and compare correctly as strings). The three notification
 * markers are stored as explicit nulls because Firestore cannot query for a
 * missing field. Queries use equality filters only, so no composite indexes
 * are required.
 */
export class FirestoreStore implements Store {
  private readonly root: DocumentReference;
  private readonly cache = new Map<string, Cached>();

  constructor(private readonly db: Firestore, spaceKey: string) {
    if (spaceKey.length < 32) throw new Error("SPACE_KEY must be at least 32 characters");
    if (spaceKey.includes("/")) throw new Error("SPACE_KEY must not contain '/'");
    this.root = db.collection("spaces").doc(spaceKey);
  }

  private get jobsCol(): CollectionReference {
    return this.root.collection("jobs");
  }

  get devices(): CollectionReference {
    return this.root.collection("devices");
  }

  // ---- watchlist and config ------------------------------------------------

  /**
   * Watchlist from Firestore; seeded from `defaults` the first time (empty
   * collection). After that Firestore is the truth for which companies are
   * listed, enabled and prioritised, but HOW a default company is read (its
   * `source`) follows the code, so an adapter change reaches an existing
   * watchlist. When a source changes, the company's scan state is dropped: the
   * new source uses different job ids, and the next scan must be a silent
   * baseline instead of alerting on every open job.
   */
  async loadWatchlist(defaults: Company[]): Promise<Company[]> {
    const col = this.root.collection("companies");
    const snap = await col.get();
    if (!snap.empty) {
      const byId = new Map(defaults.map((c) => [c.id, c]));
      const batch = this.db.batch();
      let changed = 0;
      const companies = snap.docs.map((d) => {
        const stored = d.data() as Company;
        const source = byId.get(stored.id)?.source;
        if (!source || stable(source) === stable(stored.source)) return stored;
        const wasPending = stored.source?.kind === "pending";
        const next: Company = { ...stored, source, enabled: wasPending && source.kind !== "pending" ? true : stored.enabled };
        batch.set(col.doc(stored.id), clean(next));
        batch.delete(this.root.collection("state").doc(stored.id));
        changed++;
        return next;
      });
      if (changed) await batch.commit();
      return companies;
    }
    for (let i = 0; i < defaults.length; i += BATCH) {
      const batch = this.db.batch();
      for (const c of defaults.slice(i, i + BATCH)) batch.set(col.doc(c.id), clean(c));
      await batch.commit();
    }
    return defaults;
  }

  /** Profile and settings: Firestore values override the defaults field by field. */
  async loadConfig(defaults: { profile: Profile; settings: Settings }): Promise<{ profile: Profile; settings: Settings }> {
    const cfg = this.root.collection("config");
    const [p, s] = await this.db.getAll(cfg.doc("profile"), cfg.doc("settings"));
    const profile = { ...defaults.profile, ...(p?.data() ?? {}) } as Profile;
    const settings = sanitizeSettings(s?.data() as Partial<Settings> | undefined, defaults.settings);
    if (!Array.isArray(profile.skills) || profile.skills.length === 0) profile.skills = defaults.profile.skills;
    return { profile, settings };
  }

  /** Scan health of every company, as shown on the dashboard's Health page. */
  async loadHealth(): Promise<Record<string, CompanyHealth>> {
    const snap = await this.root.collection("health").get();
    return Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as CompanyHealth]));
  }

  // ---- per-company state -----------------------------------------------------

  async loadCompanyState(companyId: string): Promise<CompanyState> {
    const snap = await this.root.collection("state").doc(companyId).get();
    const d = snap.data() as Partial<StateDoc> | undefined;
    const seen = d?.seen ?? [];
    const open = d?.openMatched ?? [];
    const initialized = d?.initialized ?? false;
    const consecutiveFailures = d?.consecutiveFailures ?? 0;
    this.cache.set(companyId, {
      open: new Set(open),
      consecutiveFailures,
      fingerprint: snap.exists ? fingerprint({ seen, initialized, openMatched: open, consecutiveFailures }) : "",
    });
    return { seen: new Set(seen), initialized };
  }

  private async cached(companyId: string): Promise<Cached> {
    if (!this.cache.has(companyId)) await this.loadCompanyState(companyId);
    return this.cache.get(companyId)!;
  }

  async saveCompanyState(companyId: string, state: CompanyState, health: CompanyHealth): Promise<void> {
    const c = await this.cached(companyId);
    const doc: StateDoc = {
      seen: [...state.seen],
      initialized: state.initialized,
      openMatched: [...c.open].slice(-OPEN_CAP),
      consecutiveFailures: health.consecutiveFailures,
    };
    const batch = this.db.batch();
    batch.set(this.root.collection("health").doc(companyId), clean(health));
    const fp = fingerprint(doc);
    // The seen list rarely changes between runs; skip the (larger) write when it has not.
    if (fp !== c.fingerprint) batch.set(this.root.collection("state").doc(companyId), doc);
    await batch.commit();
    c.fingerprint = fp;
    c.consecutiveFailures = health.consecutiveFailures;
  }

  /**
   * Only the failure count is kept with the state document (saves a read per
   * company per run); the other fields are placeholders. The pipeline uses
   * this solely to count consecutive failures.
   */
  async getHealth(companyId: string): Promise<CompanyHealth | undefined> {
    const c = await this.cached(companyId);
    return { lastScanAt: "", ok: c.consecutiveFailures === 0, consecutiveFailures: c.consecutiveFailures, fetched: 0, matchedNew: 0 };
  }

  // ---- jobs ------------------------------------------------------------------

  async createJobs(jobs: StoredJob[]): Promise<StoredJob[]> {
    const created: StoredJob[] = [];
    for (const j of jobs) {
      try {
        await this.jobsCol.doc(j.id).create(toDoc(j));
        created.push(j);
      } catch (e) {
        if ((e as { code?: unknown }).code !== ALREADY_EXISTS) throw e;
      }
      // Track as open either way: a retried run must still be able to close it later.
      (await this.cached(j.companyId)).open.add(j.externalId);
    }
    return created;
  }

  async hasRecentRepostKey(repostKey: string, sinceIso: string): Promise<boolean> {
    const snap = await this.jobsCol.where("repostKey", "==", repostKey).get();
    return snap.docs.some((d) => (d.data() as StoredJob).firstSeenAt >= sinceIso);
  }

  async markClosed(companyId: string, openExternalIds: Set<string>, atIso: string): Promise<StoredJob[]> {
    const c = await this.cached(companyId);
    const gone = [...c.open].filter((id) => !openExternalIds.has(id));
    if (gone.length === 0) return [];
    const refs = gone.map((ext) => this.jobsCol.doc(`${safeId(companyId)}_${safeId(ext)}`));
    const snaps = await this.db.getAll(...refs);
    const closed: StoredJob[] = [];
    const batch = this.db.batch();
    for (const s of snaps) {
      if (!s.exists) continue; // purged meanwhile
      const job = fromDoc(s.data()!);
      if (job.closed) continue;
      batch.update(s.ref, { closed: true, closedAt: atIso });
      closed.push({ ...job, closed: true, closedAt: atIso });
    }
    if (closed.length) await batch.commit();
    for (const ext of gone) c.open.delete(ext);
    return closed;
  }

  async dueFound(): Promise<StoredJob[]> {
    const snap = await this.jobsCol
      .where("foundNotifiedAt", "==", null)
      .where("baseline", "==", false)
      .where("reposted", "==", false)
      .where("closed", "==", false)
      .get();
    return snap.docs.map((d) => fromDoc(d.data()));
  }

  async duePeakReminders(nowIso: string): Promise<StoredJob[]> {
    const snap = await this.jobsCol
      .where("status", "==", "not_applied")
      .where("peakRemindedAt", "==", null)
      .where("baseline", "==", false)
      .where("reposted", "==", false)
      .where("closed", "==", false)
      .get();
    return snap.docs.map((d) => fromDoc(d.data())).filter((j) => j.peakAt <= nowIso);
  }

  async dueFollowUps(appliedBeforeIso: string): Promise<StoredJob[]> {
    const snap = await this.jobsCol.where("status", "==", "applied").where("followUpRemindedAt", "==", null).get();
    // A stage (interview, offer, rejected) means the company replied: nothing to follow up.
    return snap.docs.map((d) => fromDoc(d.data())).filter((j) => !j.stage && !!j.appliedAt && j.appliedAt <= appliedBeforeIso);
  }

  async markNotified(ids: string[], field: NotifyField, atIso: string): Promise<void> {
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = this.db.batch();
      for (const id of ids.slice(i, i + BATCH)) batch.update(this.jobsCol.doc(id), { [field]: atIso });
      await batch.commit();
    }
  }

  /** Runs at most once per UTC day, so old applied jobs are not re-read every 15 minutes. */
  async purgeOld(beforeIso: string): Promise<number> {
    const meta = this.root.collection("meta").doc("scanner");
    const today = new Date().toISOString().slice(0, 10);
    if (((await meta.get()).data() as { lastPurgeDay?: string } | undefined)?.lastPurgeDay === today) return 0;

    const snap = await this.jobsCol.where("firstSeenAt", "<", beforeIso).get();
    const stale = snap.docs.filter((d) => (d.data() as StoredJob).status !== "applied");
    for (let i = 0; i < stale.length; i += BATCH) {
      const batch = this.db.batch();
      for (const d of stale.slice(i, i + BATCH)) batch.delete(d.ref);
      await batch.commit();
    }
    await meta.set({ lastPurgeDay: today }, { merge: true });
    return stale.length;
  }
}

/** JSON with sorted keys, for comparing objects whatever their key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** Drop undefined values (Firestore rejects them). */
function clean<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

function fingerprint(d: StateDoc): string {
  return JSON.stringify([d.seen, d.initialized, d.openMatched, d.consecutiveFailures]);
}

export function toDoc(j: StoredJob): Record<string, unknown> {
  const d = clean(j) as unknown as Record<string, unknown>;
  for (const f of NOTIFY_FIELDS) d[f] = j[f] ?? null;
  return d;
}

export function fromDoc(d: Record<string, unknown>): StoredJob {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== null) out[k] = v;
  return out as unknown as StoredJob;
}
