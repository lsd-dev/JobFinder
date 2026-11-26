import type { PushMessage } from "./notify/messages.js";
import type { CompanyHealth } from "./store/types.js";
import type { Company } from "./types.js";

const HOUR = 3_600_000;
/** No company scanned for this long means the 15-minute schedule itself has stopped. */
export const STALE_AFTER_HOURS = 3;
/** About one day of 15-minute runs without a single success. */
export const FAILING_AFTER = 96;

export interface HealthSummary {
  /** Enabled companies with a supported source. */
  scanned: number;
  /** Of those, how many have failed every run for about a day or more. */
  failing: number;
  /** Of those, how many have no health record yet. */
  neverScanned: number;
  /** True when no company at all has been scanned recently. */
  stale: boolean;
}

export function summarizeHealth(companies: Company[], health: Record<string, CompanyHealth>, now: Date): HealthSummary {
  const active = companies.filter((c) => c.enabled && c.source.kind !== "pending");
  let failing = 0;
  let neverScanned = 0;
  let latest = 0;
  for (const c of active) {
    const h = health[c.id];
    if (!h) {
      neverScanned++;
      continue;
    }
    const at = Date.parse(h.lastScanAt);
    if (Number.isFinite(at)) latest = Math.max(latest, at);
    if (!h.ok && h.consecutiveFailures >= FAILING_AFTER) failing++;
  }
  const stale = active.length > 0 && now.getTime() - latest > STALE_AFTER_HOURS * HOUR;
  return { scanned: active.length, failing, neverScanned, stale };
}

/** The weekly push, or null when there is nothing to report. Counts only; details are on the Health page. */
export function healthMessage(s: HealthSummary): PushMessage | null {
  if (s.stale) {
    return {
      title: "JobFinder: scans have stopped",
      body: `No company has been scanned in the last ${STALE_AFTER_HOURS} hours. Check the Scan workflow on GitHub.`,
      link: "/?tab=health",
      tag: "health",
      requireInteraction: true,
    };
  }
  if (s.failing === 0) return null;
  return {
    title: s.failing === 1 ? "JobFinder: 1 career site is failing" : `JobFinder: ${s.failing} career sites are failing`,
    body: "No successful scan for about a day or more. Open Health for details.",
    link: "/?tab=health",
    tag: "health",
    requireInteraction: false,
  };
}
