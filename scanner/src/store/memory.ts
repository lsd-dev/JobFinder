import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { StoredJob } from "../types.js";
import type { CompanyHealth, CompanyState, NotifyField, Store } from "./types.js";

interface Snapshot {
  companies: Record<string, { seen: string[]; initialized: boolean; health?: CompanyHealth }>;
  jobs: Record<string, StoredJob>;
}

/**
 * In-memory Store, optionally persisted to a local JSON file so repeated
 * `--dry-run` scans behave like production (first run seeds, later runs only
 * report new jobs). Also the Store used by unit tests.
 */
export class MemoryStore implements Store {
  private snap: Snapshot = { companies: {}, jobs: {} };

  constructor(private readonly file?: string) {}

  async load(): Promise<this> {
    if (!this.file) return this;
    try {
      this.snap = JSON.parse(await readFile(this.file, "utf8")) as Snapshot;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return this;
  }

  async flush(): Promise<void> {
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.snap, null, 1));
  }

  get jobs(): StoredJob[] {
    return Object.values(this.snap.jobs);
  }

  async loadCompanyState(id: string): Promise<CompanyState> {
    const c = this.snap.companies[id];
    return { seen: new Set(c?.seen ?? []), initialized: c?.initialized ?? false };
  }

  async saveCompanyState(id: string, state: CompanyState, health: CompanyHealth): Promise<void> {
    this.snap.companies[id] = { seen: [...state.seen], initialized: state.initialized, health };
  }

  async getHealth(id: string): Promise<CompanyHealth | undefined> {
    return this.snap.companies[id]?.health;
  }

  async createJobs(jobs: StoredJob[]): Promise<StoredJob[]> {
    const created: StoredJob[] = [];
    for (const j of jobs) {
      if (this.snap.jobs[j.id]) continue;
      this.snap.jobs[j.id] = j;
      created.push(j);
    }
    return created;
  }

  async hasRecentRepostKey(key: string, sinceIso: string): Promise<boolean> {
    return this.jobs.some((j) => j.repostKey === key && j.firstSeenAt >= sinceIso);
  }

  async markClosed(companyId: string, open: Set<string>, atIso: string): Promise<StoredJob[]> {
    const closed: StoredJob[] = [];
    for (const j of this.jobs) {
      if (j.companyId === companyId && !j.closed && !open.has(j.externalId)) {
        j.closed = true;
        j.closedAt = atIso;
        closed.push(j);
      }
    }
    return closed;
  }

  async dueFound(): Promise<StoredJob[]> {
    return this.jobs.filter((j) => !j.foundNotifiedAt && !j.baseline && !j.reposted && !j.closed);
  }

  async duePeakReminders(nowIso: string): Promise<StoredJob[]> {
    return this.jobs.filter(
      (j) => j.status === "not_applied" && !j.closed && !j.baseline && !j.reposted && !j.peakRemindedAt && j.peakAt <= nowIso,
    );
  }

  async dueFollowUps(appliedBeforeIso: string): Promise<StoredJob[]> {
    return this.jobs.filter((j) => j.status === "applied" && !j.followUpRemindedAt && !!j.appliedAt && j.appliedAt <= appliedBeforeIso);
  }

  async markNotified(ids: string[], field: NotifyField, atIso: string): Promise<void> {
    for (const id of ids) {
      const j = this.snap.jobs[id];
      if (j) j[field] = atIso;
    }
  }

  async purgeOld(beforeIso: string): Promise<number> {
    let n = 0;
    for (const j of this.jobs) {
      if (j.status !== "applied" && j.firstSeenAt < beforeIso) {
        delete this.snap.jobs[j.id];
        n++;
      }
    }
    return n;
  }
}
