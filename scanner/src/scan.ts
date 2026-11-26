import type { Adapter, Company, RawJob, StoredJob } from "./types.js";
import type { Profile, Settings } from "./config/profile.js";
import { isValidTimeZone, sanitizeSettings } from "./config/profile.js";
import type { Store } from "./store/types.js";
import type { Notifier } from "./notify/messages.js";
import { followUpMessage, foundMessage, peakMessage } from "./notify/messages.js";
import { adapterFor } from "./adapters/index.js";
import { classify } from "./match/classify.js";
import { classifyLocation } from "./match/location.js";
import { topKeywords } from "./match/keywords.js";
import { extractPay, visaOrRelocation, workAuthBlock } from "./match/extras.js";
import { computePeak } from "./schedule/peak.js";
import { norm, safeId } from "./text.js";
import { redact } from "./http.js";

const DAY = 86_400_000;
/** Cap per company so the seen-ids doc stays far below Firestore's 1 MB limit. */
const SEEN_CAP = 5000;
const REPOST_WINDOW_DAYS = 30;

export interface ScanDeps {
  store: Store;
  notifier: Notifier;
  profile: Profile;
  settings: Settings;
  now?: () => Date;
  log?: (msg: string) => void;
  /** Override adapter construction (tests). */
  adapterFor?: (c: Company) => Adapter | null;
}

export interface CompanyReport {
  companyId: string;
  ok: boolean;
  fetched: number;
  fresh: number;
  matched: number;
  closed: number;
  baseline: boolean;
  error?: string;
}

export interface ScanReport {
  companies: CompanyReport[];
  notifications: { found: number; peak: number; followUp: number };
  purged: number;
}

export async function scanAll(companies: Company[], input: ScanDeps): Promise<ScanReport> {
  // Settings come from the dashboard: never let a bad value stop the scan.
  const deps: ScanDeps = { ...input, settings: sanitizeSettings(input.settings) };
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const reports: CompanyReport[] = [];
  const alertTiers = new Set(deps.settings.notifyTiers);

  // Companies run sequentially; the HTTP layer already spaces requests per host,
  // and a sequential run keeps logs readable and well under GitHub's time limits.
  for (const c of companies.filter((x) => x.enabled)) {
    reports.push(await scanCompany(c, { ...deps, now, log }));
  }

  const nowIso = now().toISOString();
  const notifications = { found: 0, peak: 0, followUp: 0 };

  // Matches in a tier the user switched alerts off for are marked as handled
  // without a push, so they neither pile up nor fire later if the setting changes.
  const found = await deps.store.dueFound();
  const foundAlerts = found.filter((j) => alertTiers.has(j.tier));
  const fm = foundMessage(foundAlerts, deps.settings.userTimeZone);
  if (fm) await deps.notifier.send(fm);
  if (found.length) await deps.store.markNotified(found.map((j) => j.id), "foundNotifiedAt", nowIso);
  notifications.found = foundAlerts.length;

  const peak = await deps.store.duePeakReminders(nowIso);
  const peakAlerts = peak.filter((j) => alertTiers.has(j.tier));
  const pm = peakMessage(peakAlerts);
  if (pm) await deps.notifier.send(pm);
  if (peak.length) await deps.store.markNotified(peak.map((j) => j.id), "peakRemindedAt", nowIso);
  notifications.peak = peakAlerts.length;

  const follow = await deps.store.dueFollowUps(new Date(now().getTime() - deps.settings.followUpDays * DAY).toISOString());
  const fu = followUpMessage(follow, deps.settings.followUpDays);
  if (fu) {
    await deps.notifier.send(fu);
    await deps.store.markNotified(follow.map((j) => j.id), "followUpRemindedAt", nowIso);
    notifications.followUp = follow.length;
  }

  const purged = await deps.store.purgeOld(new Date(now().getTime() - deps.settings.retentionDays * DAY).toISOString());
  return { companies: reports, notifications, purged };
}

async function scanCompany(company: Company, deps: Required<Pick<ScanDeps, "now" | "log">> & ScanDeps): Promise<CompanyReport> {
  const { store, log } = deps;
  // Same reason as the settings: an unusable time zone falls back instead of failing the company.
  const c = isValidTimeZone(company.hqTimeZone) ? company : { ...company, hqTimeZone: "America/Los_Angeles" };
  const startedAt = deps.now();
  const adapter = (deps.adapterFor ?? adapterFor)(c);
  const base: CompanyReport = { companyId: c.id, ok: false, fetched: 0, fresh: 0, matched: 0, closed: 0, baseline: false };
  if (!adapter) return { ...base, ok: true, error: "source not supported yet" };

  const state = await store.loadCompanyState(c.id);
  const prevHealth = await store.getHealth(c.id);
  const ctx = { isSeen: (id: string) => state.seen.has(id), log: (m: string) => log(`[${c.id}] ${m}`) };

  try {
    const raw = dedupe(await adapter.list(ctx));
    const fresh = raw.filter((j) => !state.seen.has(j.externalId));
    const baseline = !state.initialized;
    const matched: StoredJob[] = [];

    for (const job of fresh) {
      const m = await evaluate(c, adapter, job, ctx, deps, startedAt, baseline);
      if (m) matched.push(m);
    }

    const created = await store.createJobs(matched);
    const nextSeen = adapter.complete ? new Set(raw.map((j) => j.externalId)) : capSeen(state.seen, raw);
    const closed = adapter.complete ? await store.markClosed(c.id, new Set(raw.map((j) => j.externalId)), startedAt.toISOString()) : [];

    await store.saveCompanyState(
      c.id,
      { seen: nextSeen, initialized: true },
      { lastScanAt: startedAt.toISOString(), ok: true, consecutiveFailures: 0, fetched: raw.length, matchedNew: created.length },
    );
    log(`[${c.id}] fetched=${raw.length} new=${fresh.length} matched=${created.length}${baseline ? " (baseline, no alerts)" : ""}${closed.length ? ` closed=${closed.length}` : ""}`);
    return { ...base, ok: true, fetched: raw.length, fresh: fresh.length, matched: created.length, closed: closed.length, baseline };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const failures = (prevHealth?.consecutiveFailures ?? 0) + 1;
    await store.saveCompanyState(c.id, state, {
      lastScanAt: startedAt.toISOString(), ok: false, error: error.slice(0, 500), consecutiveFailures: failures, fetched: 0, matchedNew: 0,
    });
    log(`[${c.id}] FAILED (${failures} in a row): ${redact(error)}`);
    return { ...base, error };
  }
}

/** Title gate -> optional enrich -> location -> full classification. Returns null if not a match. */
async function evaluate(
  c: Company, adapter: Adapter, job: RawJob, ctx: { isSeen(id: string): boolean; log(m: string): void },
  deps: ScanDeps & { now: () => Date }, foundAt: Date, baseline: boolean,
): Promise<StoredJob | null> {
  const { profile, settings, store } = deps;

  // 1. Title-only gate: cheap, avoids detail calls for obvious non-matches.
  if (!classify({ title: job.title, company: c, profile, maxYears: settings.maxYears }).tier) return null;

  // 2. Location pre-check (skip the detail call if the list already says "wrong city").
  let loc = classifyLocation({ locations: job.locations, remoteHint: job.remoteHint, companyHqTimeZone: c.hqTimeZone });
  if (!loc.accepted && !loc.unknown) return null;

  // 3. Enrich when we lack a description or a usable location.
  let full = job;
  if (adapter.enrich && (!job.description || loc.unknown)) {
    try {
      full = await adapter.enrich(job, ctx);
    } catch (e) {
      ctx.log(`enrich failed for ${job.externalId}: ${e instanceof Error ? e.message : e}`);
    }
    loc = classifyLocation({ locations: full.locations, remoteHint: full.remoteHint, companyHqTimeZone: c.hqTimeZone });
    if (!loc.accepted) return null;
  }
  if (!loc.accepted) return null;

  // 4. Full classification with the description.
  const cls = classify({ title: full.title, description: full.description, company: c, profile, maxYears: settings.maxYears });
  if (!cls.tier) return null;
  if (loc.remote) {
    const block = workAuthBlock(full.description);
    if (block) return null;
  }

  const firstSeenAt = foundAt.toISOString();
  const repostKey = `${c.id}|${norm(full.title)}|${norm(loc.display)}`;
  const reposted = await store.hasRecentRepostKey(repostKey, new Date(foundAt.getTime() - REPOST_WINDOW_DAYS * DAY).toISOString());
  const peak = computePeak(foundAt, loc.recruiterTimeZone, settings);

  return {
    id: `${safeId(c.id)}_${safeId(full.externalId)}`,
    companyId: c.id,
    companyName: c.name,
    externalId: full.externalId,
    title: full.title,
    location: loc.display,
    remote: loc.remote,
    url: full.url,
    ...(full.postedAt ? { postedAt: full.postedAt } : {}),
    firstSeenAt,
    tier: cls.tier,
    score: cls.score + (c.priority ? 10 : 0),
    reasons: cls.reasons,
    keywords: topKeywords(`${full.title}\n${full.description ?? ""}`, profile.skills),
    ...(extractPay(full.description) ? { pay: extractPay(full.description) } : {}),
    visaOrRelocation: visaOrRelocation(full.description),
    recruiterTimeZone: loc.recruiterTimeZone,
    peakAt: peak.remindAt.toISOString(),
    applyNow: peak.applyNow,
    repostKey,
    reposted,
    baseline,
    priority: !!c.priority,
    status: "not_applied",
    closed: false,
  };
}

function dedupe(jobs: RawJob[]): RawJob[] {
  const seen = new Set<string>();
  return jobs.filter((j) => (seen.has(j.externalId) ? false : (seen.add(j.externalId), true)));
}

/** Union of old and new ids, keeping the newest SEEN_CAP (new ids first). */
function capSeen(old: Set<string>, raw: RawJob[]): Set<string> {
  const ids = [...raw.map((j) => j.externalId), ...[...old].reverse()];
  return new Set([...new Set(ids)].slice(0, SEEN_CAP).reverse());
}
