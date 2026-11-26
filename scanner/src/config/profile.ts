/**
 * Matching profile and settings. These are defaults only: once Firestore is wired
 * up, `profile/main` and `settings/main` override them, so personal details never
 * need to live in this public repo. Only a generic backend skill list is kept here.
 */
import type { Tier } from "../types.js";

export interface Profile {
  /** Skills on the resume. Used for keyword highlighting and role scoring. */
  skills: string[];
}

export interface Settings {
  userTimeZone: string;
  /** Local hours (user TZ) when no reminder should fire: [start, end) in "HH:MM". */
  quietHours: { start: string; end: string };
  /** Recruiter-local peak window on weekdays. */
  peakWindow: { start: string; end: string };
  /** Reminders that would land in quiet hours move to this user-local time the evening before. */
  eveningFallback: string;
  followUpDays: number;
  retentionDays: number;
  /** Max years of required experience still considered a match. */
  maxYears: number;
  /** Tiers that send new-match and apply-now alerts. Other matches only show on the dashboard. */
  notifyTiers: Tier[];
}

export const DEFAULT_PROFILE: Profile = {
  skills: [
    "node.js", "express", "typescript", "javascript", "python", "fastapi", "flask", "java",
    "sql", "mysql", "firestore", "firebase", "rest", "oauth", "webhooks", "idempotency",
    "docker", "linux", "git", "react", "html", "css", "c++", "c", "system design", "microservices",
  ],
};

export const DEFAULT_SETTINGS: Settings = {
  userTimeZone: "Asia/Kolkata",
  quietHours: { start: "23:00", end: "07:00" },
  peakWindow: { start: "08:00", end: "10:00" },
  eveningFallback: "22:45",
  followUpDays: 6,
  retentionDays: 30,
  maxYears: 2,
  notifyTiers: ["A", "B", "Maybe"],
};

const TIERS: Tier[] = ["A", "B", "Maybe"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a time zone name this runtime accepts, e.g. "Asia/Kolkata". */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Settings are edited on the dashboard and stored in Firestore, so the scanner
 * cannot trust their shape. Any value it could not work with (a misspelt time
 * zone would make every date calculation throw) is replaced by the default.
 */
export function sanitizeSettings(input: Partial<Settings> | undefined, defaults: Settings = DEFAULT_SETTINGS): Settings {
  const s = { ...defaults, ...(input ?? {}) };
  const time = (v: unknown, d: string) => (typeof v === "string" && TIME_RE.test(v) ? v : d);
  const num = (v: unknown, d: number, min: number) => (typeof v === "number" && Number.isFinite(v) && v >= min ? v : d);
  const tiers = Array.isArray(s.notifyTiers) ? TIERS.filter((t) => s.notifyTiers.includes(t)) : defaults.notifyTiers;
  return {
    userTimeZone: isValidTimeZone(s.userTimeZone) ? s.userTimeZone : defaults.userTimeZone,
    quietHours: { start: time(s.quietHours?.start, defaults.quietHours.start), end: time(s.quietHours?.end, defaults.quietHours.end) },
    peakWindow: { start: time(s.peakWindow?.start, defaults.peakWindow.start), end: time(s.peakWindow?.end, defaults.peakWindow.end) },
    eveningFallback: time(s.eveningFallback, defaults.eveningFallback),
    followUpDays: num(s.followUpDays, defaults.followUpDays, 1),
    retentionDays: num(s.retentionDays, defaults.retentionDays, 1),
    maxYears: num(s.maxYears, defaults.maxYears, 0),
    notifyTiers: tiers,
  };
}
