import type { StoredJob } from "../types.js";

export interface CompanyState {
  /** External ids already seen (matched or not). Lets paged sources stop early. */
  seen: Set<string>;
  /** False until the first successful scan; that scan seeds silently. */
  initialized: boolean;
}

export interface CompanyHealth {
  lastScanAt: string;
  ok: boolean;
  error?: string;
  consecutiveFailures: number;
  fetched: number;
  matchedNew: number;
}

export type NotifyField = "foundNotifiedAt" | "peakRemindedAt" | "followUpRemindedAt";

/**
 * Persistence boundary. Implemented by MemoryStore (dry runs and tests) and,
 * in the next milestone, FirestoreStore. All writes are idempotent so a retried
 * GitHub Actions run cannot duplicate jobs or notifications.
 */
export interface Store {
  loadCompanyState(companyId: string): Promise<CompanyState>;
  saveCompanyState(companyId: string, state: CompanyState, health: CompanyHealth): Promise<void>;
  /** Previous failure count, used to escalate repeated failures. */
  getHealth(companyId: string): Promise<CompanyHealth | undefined>;

  /** Create-if-absent. Returns only the jobs that were actually created. */
  createJobs(jobs: StoredJob[]): Promise<StoredJob[]>;
  /** Was a job with this repost key first seen after `sinceIso`? */
  hasRecentRepostKey(repostKey: string, sinceIso: string): Promise<boolean>;
  /** Mark stored, still-open jobs of a company closed when absent from a complete listing. */
  markClosed(companyId: string, openExternalIds: Set<string>, atIso: string): Promise<StoredJob[]>;

  dueFound(): Promise<StoredJob[]>;
  duePeakReminders(nowIso: string): Promise<StoredJob[]>;
  /** Applied before `appliedBeforeIso`, not yet reminded, and no reply recorded (no stage). */
  dueFollowUps(appliedBeforeIso: string): Promise<StoredJob[]>;
  markNotified(ids: string[], field: NotifyField, atIso: string): Promise<void>;

  /** Delete jobs you did not apply to that were first seen before `beforeIso`. */
  purgeOld(beforeIso: string): Promise<number>;
}
