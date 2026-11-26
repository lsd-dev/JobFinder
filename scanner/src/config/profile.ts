/**
 * Matching profile and settings. These are defaults only: once Firestore is wired
 * up, `profile/main` and `settings/main` override them, so personal details never
 * need to live in this public repo. Only a generic backend skill list is kept here.
 */
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
};
