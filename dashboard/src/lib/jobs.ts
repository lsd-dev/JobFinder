import type { JobStage, StoredJob, Tier } from "../types";

export type View = "todo" | "applied" | "hidden" | "closed";

export interface Filters {
  view: View;
  tiers: Set<Tier>;
  companyId: string;
  query: string;
  remoteOnly: boolean;
  /** Only jobs posted in the last 24 hours. */
  freshOnly: boolean;
  sort: "newest" | "score";
}

export const DEFAULT_FILTERS: Filters = { view: "todo", tiers: new Set(["A", "B", "Maybe"]), companyId: "", query: "", remoteOnly: false, freshOnly: false, sort: "newest" };

const TIER_ORDER: Record<Tier, number> = { A: 0, B: 1, Maybe: 2 };
const DAY = 86_400_000;

/**
 * When the company posted the job. Sources that give no posting date (or an
 * unreadable one) fall back to when the scanner first saw it.
 */
export function postedTime(j: StoredJob): number {
  const posted = j.postedAt ? Date.parse(j.postedAt) : NaN;
  return Number.isFinite(posted) ? posted : Date.parse(j.firstSeenAt);
}

/**
 * Posted within the last 24 hours, when applying early counts most. A job that
 * was already open at the first scan and has no posting date is never fresh:
 * its real age is unknown.
 */
export function isFresh(j: StoredJob, now: Date): boolean {
  const posted = j.postedAt ? Date.parse(j.postedAt) : NaN;
  const t = Number.isFinite(posted) ? posted : j.baseline ? NaN : Date.parse(j.firstSeenAt);
  return now.getTime() - t < DAY;
}

/** Which list a job belongs to. Applied wins over closed: you still want to track it. */
export function viewOf(j: StoredJob): View {
  if (j.status === "applied") return "applied";
  if (j.status === "not_interested") return "hidden";
  return j.closed ? "closed" : "todo";
}

export function countViews(jobs: StoredJob[]): Record<View, number> {
  const n: Record<View, number> = { todo: 0, applied: 0, hidden: 0, closed: 0 };
  for (const j of jobs) n[viewOf(j)]++;
  return n;
}

export function applyFilters(jobs: StoredJob[], f: Filters, now: Date = new Date()): StoredJob[] {
  const q = f.query.trim().toLowerCase();
  const out = jobs.filter(
    (j) =>
      viewOf(j) === f.view &&
      f.tiers.has(j.tier) &&
      (!f.companyId || j.companyId === f.companyId) &&
      (!f.remoteOnly || j.remote) &&
      (!f.freshOnly || isFresh(j, now)) &&
      (!q || `${j.title} ${j.companyName} ${j.location} ${j.keywords.map((k) => k.term).join(" ")}`.toLowerCase().includes(q)),
  );
  if (f.view === "applied") return out.sort((a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? ""));
  if (f.sort === "score") return out.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.score - a.score);
  return out.sort((a, b) => postedTime(b) - postedTime(a) || TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.score - a.score);
}

export const STAGES: { id: JobStage; label: string }[] = [
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Rejected" },
];

export interface AppliedStats {
  total: number;
  /** Applied in the last 7 days. */
  thisWeek: number;
  waiting: number;
  interview: number;
  offer: number;
  rejected: number;
  /** Share of applications with any reply, in percent; null when nothing is applied. */
  replyRate: number | null;
}

export function appliedStats(jobs: StoredJob[], now: Date): AppliedStats {
  const applied = jobs.filter((j) => j.status === "applied");
  const count = (s: JobStage) => applied.filter((j) => j.stage === s).length;
  const interview = count("interview");
  const offer = count("offer");
  const rejected = count("rejected");
  const replied = interview + offer + rejected;
  return {
    total: applied.length,
    thisWeek: applied.filter((j) => !!j.appliedAt && now.getTime() - Date.parse(j.appliedAt) < 7 * DAY).length,
    waiting: applied.length - replied,
    interview, offer, rejected,
    replyRate: applied.length ? Math.round((replied / applied.length) * 100) : null,
  };
}

/** A follow-up is due only while there is no reply yet. */
export function followUpDue(j: StoredJob, followUpDays: number, now: Date): boolean {
  return j.status === "applied" && !j.stage && !!j.appliedAt && now.getTime() - new Date(j.appliedAt).getTime() >= followUpDays * DAY;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago" */
export function ago(iso: string | undefined, now: Date): string {
  if (!iso) return "";
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / DAY)} d ago`;
}

/** Best-time label in the viewer's own time zone. */
export function peakLabel(j: StoredJob, now: Date): { text: string; urgent: boolean } | null {
  if (j.status !== "not_applied" || j.closed) return null;
  if (j.applyNow) return { text: "Apply now: the next peak window is over 24 h away", urgent: true };
  const at = new Date(j.peakAt);
  if (at.getTime() <= now.getTime()) return { text: "Peak window reached: apply now", urgent: true };
  const when = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(at);
  return { text: `Best time to apply: ${when}`, urgent: false };
}

/** LinkedIn people-search links. Plain search URLs you open yourself; nothing is scraped. */
export function linkedInSearch(j: StoredJob, kind: "manager" | "referral"): string {
  const city = j.remote ? "" : (j.location.split("/")[0] ?? "").trim();
  const who = kind === "manager" ? "engineering manager" : "software engineer";
  const keywords = [j.companyName, who, city].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

export function referralMessage(j: StoredJob): string {
  return (
    `Hi, I came across the ${j.title} role at ${j.companyName} (${j.location}) and it looks like a strong fit for my backend experience. ` +
    `Would you be open to referring me, or pointing me to the right person on the team? Happy to share my resume. ` +
    `Job link: ${j.url}\nThank you!`
  );
}
