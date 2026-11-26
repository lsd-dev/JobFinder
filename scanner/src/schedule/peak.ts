/**
 * Peak-time apply reminders.
 *
 * Target: the start of the recruiter's 08:00-10:00 weekday window, in the
 * recruiter's time zone, so the application is near the top of their inbox
 * when their day starts. If that instant falls in the user's quiet hours
 * (23:00-07:00 IST), remind at 22:45 IST the evening before instead: the
 * application still lands before the recruiter's morning. If that evening has
 * already passed, remind when quiet hours end.
 *
 * Time-zone math uses Intl only (no dependencies) and is DST-safe because
 * offsets are recomputed at the target instant.
 */

const HOUR = 3_600_000;

interface Parts { y: number; m: number; d: number; h: number; mi: number; wd: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(ts: number, tz: string): Parts {
  const p: Record<string, string> = {};
  for (const { type, value } of fmt(tz).formatToParts(new Date(ts))) p[type] = value;
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, wd: WD[p.weekday!] ?? 0 };
}

function offsetAt(ts: number, tz: string): number {
  const p = zonedParts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ts / 60_000) * 60_000;
}

/** UTC instant for a wall-clock time in `tz`. Day overflow (d+1) is allowed. */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ts = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(ts, tz); // re-check across a DST boundary
  if (second !== ts) ts = second;
  return ts;
}

function hm(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [h ?? 0, m ?? 0];
}

export function inQuietHours(ts: number, tz: string, quiet: { start: string; end: string }): boolean {
  const p = zonedParts(ts, tz);
  const mins = p.h * 60 + p.mi;
  const [sh, sm] = hm(quiet.start);
  const [eh, em] = hm(quiet.end);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return s > e ? mins >= s || mins < e : mins >= s && mins < e;
}

export interface PeakSettings {
  userTimeZone: string;
  quietHours: { start: string; end: string };
  peakWindow: { start: string; end: string };
  eveningFallback: string;
}

export interface PeakResult {
  /** When to send the "apply now" reminder. */
  remindAt: Date;
  /** Start of the recruiter's peak window that the reminder targets. */
  windowStart: Date;
  /** More than 24h until the reminder: tell the user to apply now instead. */
  applyNow: boolean;
}

/** Next weekday window in `tz` that has not ended at `from`. */
function nextWindow(from: number, tz: string, win: { start: string; end: string }): { start: number; end: number } {
  const p = zonedParts(from, tz);
  const [sh, sm] = hm(win.start);
  const [eh, em] = hm(win.end);
  for (let k = 0; k <= 8; k++) {
    const start = zonedTimeToUtc(p.y, p.m, p.d + k, sh, sm, tz);
    const end = zonedTimeToUtc(p.y, p.m, p.d + k, eh, em, tz);
    const wd = zonedParts(start, tz).wd;
    if (wd === 0 || wd === 6) continue;
    if (from < end) return { start, end };
  }
  throw new Error(`no peak window found for ${tz}`); // unreachable: a weekday occurs within 8 days
}

export function computePeak(foundAt: Date, recruiterTz: string, s: PeakSettings): PeakResult {
  const found = foundAt.getTime();
  const win = nextWindow(found, recruiterTz, s.peakWindow);
  let remindAt = Math.max(win.start, found);

  if (inQuietHours(remindAt, s.userTimeZone, s.quietHours)) {
    // Latest evening-fallback time (user TZ) strictly before the target.
    const up = zonedParts(remindAt, s.userTimeZone);
    const [fh, fm] = hm(s.eveningFallback);
    let fallback = zonedTimeToUtc(up.y, up.m, up.d, fh, fm, s.userTimeZone);
    if (fallback > remindAt) fallback = zonedTimeToUtc(up.y, up.m, up.d - 1, fh, fm, s.userTimeZone);
    if (fallback >= found) {
      remindAt = fallback;
    } else {
      // Evening already gone: first moment quiet hours end after the target.
      const [qh, qm] = hm(s.quietHours.end);
      let end = zonedTimeToUtc(up.y, up.m, up.d, qh, qm, s.userTimeZone);
      if (end <= remindAt) end = zonedTimeToUtc(up.y, up.m, up.d + 1, qh, qm, s.userTimeZone);
      remindAt = end;
    }
  }
  return { remindAt: new Date(remindAt), windowStart: new Date(win.start), applyNow: remindAt - found > 24 * HOUR };
}

/** "Tue 8:00 AM PST (9:30 PM IST)" style label for notifications and the dashboard. */
export function describePeak(r: PeakResult, recruiterTz: string, userTz: string): string {
  const f = (d: Date, tz: string, withDay: boolean) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: withDay ? "short" : undefined, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d);
  const local = f(r.windowStart, recruiterTz, true);
  return recruiterTz === userTz ? local : `${local} (you: ${f(r.remindAt, userTz, true)})`;
}
