import type { StoredJob } from "../types.js";

export interface PushMessage {
  title: string;
  body: string;
  /** Opens the dashboard at this path when tapped. */
  link: string;
  /** Collapse key so a newer message of the same kind replaces an older one. */
  tag: string;
  /** Priority companies: stay on screen until dismissed. */
  requireInteraction: boolean;
}

export interface Notifier {
  send(msg: PushMessage): Promise<void>;
}

const TIER_ORDER = { A: 0, B: 1, Maybe: 2 } as const;
const byTier = (a: StoredJob, b: StoredJob) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.score - a.score;

function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

/** One grouped "new matches" notification per scan. */
export function foundMessage(jobs: StoredJob[], userTz: string): PushMessage | null {
  if (!jobs.length) return null;
  const sorted = [...jobs].sort(byTier);
  const top = sorted[0]!;
  const priority = sorted.some((j) => j.priority);
  if (sorted.length === 1) {
    const when = top.applyNow ? "Apply now (next peak window is more than 24h away)" : `Best time to apply: ${fmtTime(top.peakAt, userTz)}`;
    return {
      title: `New Tier ${top.tier}: ${top.companyName} · ${top.title}`,
      body: `${top.location} · ${when}`,
      link: `/?job=${encodeURIComponent(top.id)}`,
      tag: "found",
      requireInteraction: priority,
    };
  }
  const names = sorted.slice(0, 3).map((j) => `${j.companyName} ${j.title}`);
  const more = sorted.length > 3 ? `, +${sorted.length - 3} more` : "";
  const a = sorted.filter((j) => j.tier === "A").length;
  return {
    title: `${sorted.length} new matches${a ? ` (${a} Tier A)` : ""}`,
    body: names.join(", ") + more,
    link: "/?view=new",
    tag: "found",
    requireInteraction: priority,
  };
}

/** "Apply now" at the recruiter's peak window. */
export function peakMessage(jobs: StoredJob[]): PushMessage | null {
  if (!jobs.length) return null;
  const sorted = [...jobs].sort(byTier);
  const top = sorted[0]!;
  const recruiterTime = new Intl.DateTimeFormat("en-IN", { timeZone: top.recruiterTimeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date());
  if (sorted.length === 1) {
    return {
      title: `⏰ Apply now: ${top.companyName} · ${top.title}`,
      body: `Recruiter's local time is ${recruiterTime}, the start of their day. ${top.location}`,
      link: `/?job=${encodeURIComponent(top.id)}`,
      tag: "peak",
      requireInteraction: true,
    };
  }
  return {
    title: `⏰ Peak time: apply to ${sorted.length} jobs now`,
    body: sorted.slice(0, 3).map((j) => `${j.companyName} ${j.title}`).join(", ") + (sorted.length > 3 ? `, +${sorted.length - 3} more` : ""),
    link: "/?view=peak",
    tag: "peak",
    requireInteraction: true,
  };
}

export function followUpMessage(jobs: StoredJob[], days: number): PushMessage | null {
  if (!jobs.length) return null;
  const top = jobs[0]!;
  return {
    title: jobs.length === 1 ? `Follow up: ${top.companyName} · ${top.title}` : `Follow up on ${jobs.length} applications`,
    body: `Applied ${days}+ days ago. Message the hiring manager or ask a connection for a referral.`,
    link: "/?view=applied",
    tag: "followup",
    requireInteraction: false,
  };
}

/** Dry-run notifier: prints instead of pushing. */
export class ConsoleNotifier implements Notifier {
  readonly sent: PushMessage[] = [];
  async send(msg: PushMessage): Promise<void> {
    this.sent.push(msg);
    console.log(`\n[push] ${msg.title}\n       ${msg.body}\n       -> ${msg.link}${msg.requireInteraction ? " (sticky)" : ""}`);
  }
}
