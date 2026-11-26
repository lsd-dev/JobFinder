/** Shared types for the scanner. Kept framework-free so the dashboard can mirror them. */

export type SourceKind =
  | "greenhouse"
  | "lever"
  | "workday"
  | "amazon"
  | "microsoft"
  | "google"
  | "apple"
  | "atlassian"
  | "oracle";

/** One watchlist entry. `source` holds the adapter-specific settings. */
export interface Company {
  id: string; // stable slug, e.g. "amazon"
  name: string;
  enabled: boolean;
  /** Recruiter time zone used for plain "Remote" roles (IANA name). */
  hqTimeZone: string;
  /** Priority companies get notifications that stay on screen until dismissed. */
  priority?: boolean;
  /** Per-company title-level overrides, e.g. Google "III" is mid-level, not senior. */
  levelOverrides?: Record<string, "entry" | "ok">;
  note?: string;
  source: SourceConfig;
}

export type SourceConfig =
  | { kind: "greenhouse"; board: string }
  | { kind: "lever"; site: string }
  | { kind: "workday"; host: string; tenant: string; site: string; searchText?: string; indiaFacet?: Record<string, string[]> }
  | { kind: "amazon" }
  | { kind: "microsoft" }
  | { kind: "google" }
  | { kind: "apple" }
  | { kind: "atlassian" }
  | { kind: "oracle"; host: string; siteNumber: string; publicBase: string }
  | { kind: "pending"; reason: string };

/** A posting as returned by an adapter, before classification. */
export interface RawJob {
  externalId: string;
  title: string;
  /** Free-text locations as the source reports them. */
  locations: string[];
  url: string;
  /** When the source says it was posted, if it says (ISO string). */
  postedAt?: string;
  /** Plain-text description / qualifications if the list call includes it. */
  description?: string;
  /** True when the source itself marks the role remote. */
  remoteHint?: boolean;
}

export interface Adapter {
  /** True when list() returns every open job, so absence means "closed". */
  readonly complete: boolean;
  /**
   * Fetch newest-first. `isSeen` lets paged sources stop early once they
   * reach a job already stored, so a normal run reads one page.
   */
  list(ctx: AdapterContext): Promise<RawJob[]>;
  /** Optional second call for jobs that passed the title gate (adds description/locations). */
  enrich?(job: RawJob, ctx: AdapterContext): Promise<RawJob>;
}

export interface AdapterContext {
  isSeen(externalId: string): boolean;
  log(msg: string): void;
}

export type Tier = "A" | "B" | "Maybe";
export type JobStatus = "not_applied" | "applied" | "not_interested";

export interface LocationResult {
  accepted: boolean;
  /** Normalized display, e.g. "Bengaluru" or "Remote (global)". */
  display: string;
  remote: boolean;
  /** IANA time zone of the recruiter for peak-time reminders. */
  recruiterTimeZone: string;
  reason?: string;
}

export interface Classification {
  tier: Tier | null; // null = rejected
  score: number;
  reasons: string[];
  minYears?: number;
}

/** A matched job as stored in Firestore and shown on the dashboard. */
export interface StoredJob {
  id: string; // `${companyId}_${externalId}` (sanitized)
  companyId: string;
  companyName: string;
  externalId: string;
  title: string;
  location: string;
  remote: boolean;
  url: string;
  postedAt?: string;
  firstSeenAt: string;
  tier: Tier;
  score: number;
  reasons: string[];
  keywords: { term: string; onResume: boolean }[];
  pay?: string;
  visaOrRelocation?: boolean;
  recruiterTimeZone: string;
  peakAt: string;
  /** Next peak window is more than 24h after first seen: apply now instead of waiting. */
  applyNow: boolean;
  repostKey: string;
  reposted: boolean;
  baseline: boolean;
  priority: boolean;
  status: JobStatus;
  appliedAt?: string;
  closed: boolean;
  closedAt?: string;
  notes?: string;
  foundNotifiedAt?: string;
  peakRemindedAt?: string;
  followUpRemindedAt?: string;
}
