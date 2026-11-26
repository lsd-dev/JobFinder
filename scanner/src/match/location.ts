import type { LocationResult } from "../types.js";
import { norm } from "../text.js";

/** Target Indian cities with the spellings career sites actually use. */
const CITIES: { name: string; re: RegExp }[] = [
  { name: "Bengaluru", re: /\b(bengaluru|bangalore|blr)\b/ },
  { name: "Hyderabad", re: /\b(hyderabad|hyd|secunderabad)\b/ },
  { name: "Pune", re: /\bpune\b/ },
  { name: "Gurugram", re: /\b(gurugram|gurgaon)\b/ },
  { name: "Noida", re: /\b(noida|greater noida)\b/ },
  { name: "Delhi", re: /\b(new delhi|delhi|ncr)\b/ },
];

const IST = "Asia/Kolkata";
const REMOTE_RE = /\b(remote|anywhere|worldwide|work from home|wfh|distributed)\b/;
/** Words left over after removing "remote" that do not restrict where you can live. */
const FILLER_RE =
  /\b(remote|first|friendly|fully|100%|work|from|home|wfh|option(al)?|available|eligible|role|position|job|location|locations|based|hybrid|flexible|anywhere|worldwide|global(ly)?|international|distributed|multiple|any|country|countries|team)\b/g;
// No bare "in": "remote in the us" must not read as India.
const INDIA_RE = /\b(india|ind)\b/;
const APAC_RE = /\b(apac|asia|asia pacific|apj)\b/;
/** "N Locations" style placeholders (Workday) mean we need the job detail call. */
const PLACEHOLDER_RE = /^(\d+\s+locations?|multiple locations?|various locations?)$/;

export interface LocationInput {
  locations: string[];
  remoteHint?: boolean;
  companyHqTimeZone: string;
}

export interface LocationVerdict extends LocationResult {
  /** True when the source gave a placeholder and the detail call should be made. */
  unknown?: boolean;
}

/** Classify one free-text location string. */
function classifyOne(raw: string, hint: boolean, hqTz: string): LocationVerdict {
  const s = norm(raw).replace(/[(),;/|•·]+/g, " ").replace(/\s+-\s+|\s+–\s+/g, " ").replace(/\s+/g, " ").trim();
  if (PLACEHOLDER_RE.test(s)) {
    return { accepted: false, unknown: true, display: raw, remote: false, recruiterTimeZone: hqTz, reason: "placeholder location" };
  }
  const isRemote = hint || REMOTE_RE.test(s);
  if (isRemote) {
    const remainder = s.replace(FILLER_RE, " ").replace(/[-–,.:]+/g, " ").replace(/\s+/g, " ").trim();
    if (remainder === "") return { accepted: true, display: "Remote (global)", remote: true, recruiterTimeZone: hqTz };
    if (INDIA_RE.test(remainder) || CITIES.some((c) => c.re.test(remainder))) {
      return { accepted: true, display: "Remote (India)", remote: true, recruiterTimeZone: IST };
    }
    if (APAC_RE.test(remainder)) return { accepted: true, display: "Remote (APAC)", remote: true, recruiterTimeZone: "Asia/Singapore" };
    return { accepted: false, display: raw, remote: true, recruiterTimeZone: hqTz, reason: `remote restricted to "${remainder}"` };
  }
  const city = CITIES.find((c) => c.re.test(s));
  if (city) return { accepted: true, display: city.name, remote: false, recruiterTimeZone: IST };
  // Country-only "India" (Apple, Oracle): city not given, may well be a target city.
  if (/^(india|ind|in)$/.test(s)) return { accepted: true, display: "India (city not listed)", remote: false, recruiterTimeZone: IST };
  return { accepted: false, display: raw, remote: false, recruiterTimeZone: hqTz, reason: "outside target locations" };
}

/**
 * A job matches if ANY of its locations is a target city or acceptable remote.
 * Cities win over remote for the recruiter time zone (an Indian office is IST).
 */
export function classifyLocation(input: LocationInput): LocationVerdict {
  const locs = input.locations.length ? input.locations : input.remoteHint ? ["Remote"] : [];
  if (locs.length === 0) {
    return { accepted: false, unknown: true, display: "Unknown", remote: false, recruiterTimeZone: input.companyHqTimeZone, reason: "no location" };
  }
  const verdicts = locs.map((l) => classifyOne(l, false, input.companyHqTimeZone));
  // A remoteHint with no explicit remote location string: treat as plain remote too.
  if (input.remoteHint && !verdicts.some((v) => v.remote)) verdicts.push(classifyOne("Remote", true, input.companyHqTimeZone));

  let cities = [...new Set(verdicts.filter((v) => v.accepted && !v.remote).map((v) => v.display))];
  // "Bengaluru / India (city not listed)" -> "Bengaluru": the country-only entry adds nothing.
  if (cities.length > 1) cities = cities.filter((d) => d !== "India (city not listed)");
  if (cities.length) {
    const remoteToo = verdicts.some((v) => v.accepted && v.remote);
    return { accepted: true, display: cities.join(" / ") + (remoteToo ? " / Remote" : ""), remote: false, recruiterTimeZone: IST };
  }
  const remote = verdicts.find((v) => v.accepted);
  if (remote) return remote;
  if (verdicts.every((v) => v.unknown)) return verdicts[0]!;
  const rejected = verdicts.find((v) => !v.unknown) ?? verdicts[0]!;
  return { ...rejected, display: locs.join(" / ") };
}
