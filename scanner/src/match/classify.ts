import type { Classification, Company, Tier } from "../types.js";
import type { Profile } from "../config/profile.js";
import { norm } from "../text.js";
import { skillHits } from "./keywords.js";

/**
 * Rule-based role + level classifier for a backend-leaning engineer with
 * < 1 year full-time experience. Every rejection carries a reason so the
 * matcher's behaviour can be audited in tests and on the dashboard.
 */

/** Title must look like a software development role. */
const DEV_RE = /\b(engineer|engineering|developer|sde|swe|programmer|member of technical staff|mts)\b/;

/** Roles you asked not to see (software development only). */
const ROLE_EXCLUDE: [RegExp, string][] = [
  [/\b(qa|sdet|quality assurance|quality engineer|test engineer|testing|tester|engineers? in test|test automation|automation engineer|validation engineer|verification engineer)\b/, "QA / test role"],
  [/\b(ios|android|mobile)\b/, "mobile role"],
  [/\b(data scientist|research scientist|applied scientist|scientist|research engineer|ml research)\b/, "research / data science role"],
  [/\b(sales|pre-?sales|solutions? (engineer|architect|consultant)|customer (success|engineer|support|experience)|support engineer|technical support|product support|technical account|field engineer|partner engineer|professional services|implementation (engineer|consultant|specialist)|forward deployed)\b/, "customer-facing role"],
  [/\b(hardware|asic|rtl|fpga|silicon|analog|physical design|layout|electrical|mechanical|manufacturing|network engineer|firmware|embedded|chip|soc|gpu architecture|thermal|signal integrity)\b/, "hardware / non-software engineering"],
  [/\b(designer|product manager|program manager|project manager|analyst|analytics|business intelligence|bi engineer|language engineer|linguist|marketing|recruit\w*|legal|finance|accountant)\b/, "non-engineering role"],
  [/\b(intern|internship|apprentice\w*|co-?op|trainee)\b/, "internship"],
  [/\bph\.?\s?d\b/, "PhD-only role"],
];

/** Front-end only is excluded, but full-stack titles that mention front end are kept. */
const FRONTEND_ONLY_RE = /\b(front[- ]?end|ui engineer|ui developer|ux engineer)\b/;
const FULLSTACK_RE = /\b(full[- ]?stack)\b/;

const SENIOR_RE = /\b(senior|sr|snr|staff|principal|lead|manager|management|director|architect|head|vp|vice president|distinguished|fellow|expert)\b/;
const ENTRY_RE = /\b(new grad(uate)?|graduate|entry[- ]level|entry|junior|jr|associate|early career|university|campus|fresher|freshers|level 1|0-?2 (yrs|years))\b/;
const STRONG_RE = /\b(backend|back[- ]end|full[- ]?stack|platform|api|apis|server|server[- ]side|distributed|microservices?|services|infrastructure|cloud)\b/;

/** Level numeral right after the role word: "Software Engineer II", "SDE-1", "SDE III", "MTS 2". */
const NUMERAL_RE = /\b(?:engineer|developer|sde|swe|mts|programmer)\s*[-,]?\s*(i{1,3}|iv|v|[1-5])\b/;
const LEVEL_FROM_NUMERAL: Record<string, number> = { i: 1, "1": 1, ii: 2, "2": 2, iii: 3, "3": 3, iv: 4, "4": 4, v: 5, "5": 5 };
const ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };

/**
 * Required years of experience: the FIRST "N years ... experience" mention.
 * Minimum qualifications come first on every source we scan (Google, Amazon,
 * Greenhouse templates), so the first mention is the requirement, and later
 * "preferred" mentions are ignored.
 */
export function requiredYears(text: string): number | undefined {
  const t = norm(text);
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?)?\s*(?:years?|yrs?)\b([^.\n]{0,80})/g;
  for (const m of t.matchAll(re)) {
    const tail = m[2] ?? "";
    const head = t.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    if (/experience|exp\b|industry|professional|working|software|development|programming|coding/.test(tail + " " + head)) {
      const n = Number(m[1]);
      if (n <= 20) return n;
    }
  }
  return undefined;
}

/**
 * Minimum years stated in the title itself, e.g. "Software Engineer (3-5)",
 * "SRE (4 to 8 Years)" or "Backend Engineer, 5+ years". Some companies
 * (PhonePe) state the range only there.
 */
export function titleYears(title: string): number | undefined {
  const m =
    /(\d{1,2})\s*(?:-|–|to)\s*\d{1,2}\s*\+?\s*(?:years?|yrs?)\b/i.exec(title) ??
    /\(\s*(\d{1,2})\s*(?:-|–|to)\s*\d{1,2}\s*\)/.exec(title) ??
    /(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i.exec(title);
  const n = m ? Number(m[1]) : NaN;
  return n <= 20 ? n : undefined;
}

export interface ClassifyInput {
  title: string;
  description?: string;
  company: Pick<Company, "levelOverrides">;
  profile: Profile;
  maxYears: number;
}

export function classify(input: ClassifyInput): Classification {
  const title = norm(input.title).replace(/[()[\],/|]+/g, " ").replace(/\s+/g, " ");
  const desc = input.description ?? "";
  const reasons: string[] = [];
  const reject = (why: string): Classification => ({ tier: null, score: 0, reasons: [why] });

  // Exclusions first so the reason names the actual role (e.g. "SDET" is a QA role).
  for (const [re, why] of ROLE_EXCLUDE) if (re.test(title)) return reject(why);
  if (!DEV_RE.test(title)) return reject("not a software development title");
  if (FRONTEND_ONLY_RE.test(title) && !FULLSTACK_RE.test(title)) return reject("front-end only role");
  if (SENIOR_RE.test(title)) return reject("senior / lead level");

  // Level from numerals, with per-company overrides (e.g. Google III is mid-level).
  let entry = ENTRY_RE.test(title);
  let numeralOk = false;
  let levelLabel = "";
  const num = NUMERAL_RE.exec(title);
  if (num) {
    const level = LEVEL_FROM_NUMERAL[num[1]!] ?? 0;
    levelLabel = `level ${ROMAN[level] ?? level}`;
    const override = input.company.levelOverrides?.[ROMAN[level] ?? ""];
    if (override === "entry") entry = true;
    else if (override === "ok") numeralOk = true;
    else if (level === 1) entry = true;
    else if (level === 2) numeralOk = true;
    else return reject(`${levelLabel} is above target`);
  }

  // A range in the title is explicit, so it wins over the description.
  const minYears = titleYears(input.title) ?? (desc ? requiredYears(desc) : undefined);
  if (minYears !== undefined) {
    if (minYears > input.maxYears) return { tier: null, score: 0, reasons: [`requires ${minYears}+ years`], minYears };
    if (minYears <= 1) entry = true;
    reasons.push(`${minYears} yr requirement`);
  }

  const strong = STRONG_RE.test(title) || FULLSTACK_RE.test(title);
  const hits = skillHits(`${input.title}\n${desc}`, input.profile.skills);
  if (entry) reasons.push("entry level");
  if (numeralOk) reasons.push(levelLabel);
  if (strong) reasons.push("backend / full-stack title");
  if (hits.length) reasons.push(`skills: ${hits.slice(0, 6).join(", ")}`);

  const levelKnown = entry || numeralOk || minYears !== undefined;
  let tier: Tier;
  if ((entry || minYears === 2) && (strong || hits.length >= 3)) tier = "A";
  else if (levelKnown || strong || hits.length >= 3) tier = "B";
  else tier = "Maybe";

  const score =
    (entry ? 30 : 0) + (minYears !== undefined && minYears <= input.maxYears ? 15 : 0) + (numeralOk ? 5 : 0) + (strong ? 20 : 0) + Math.min(hits.length * 5, 40);
  return { tier, score, reasons, minYears };
}
