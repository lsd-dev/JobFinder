import { norm } from "../text.js";

/**
 * Remote roles that say you must live or be authorized to work somewhere other
 * than India. Only applied to remote jobs; India-office jobs are local by definition.
 */
const WORK_AUTH_RES: RegExp[] = [
  /\b(must|need to|required to|should) (be )?(legally )?(authorized|eligible|permitted) to work in (the )?(us|u\.s\.|usa|united states|canada|uk|united kingdom|eu|europe|australia|germany|ireland|netherlands)\b/,
  /\b(us|u\.s\.) citizen(s|ship)?( only| required)?\b/,
  /\b(security|government) clearance\b/,
  /\bgreen card\b/,
  /\b(must|need to|required to|should) (be )?(located|based|reside|residing|live|living) in (the )?(us|u\.s\.|usa|united states|canada|uk|united kingdom|eu|europe|emea|latam|americas|north america|australia|germany|ireland|netherlands|spain|poland|brazil|mexico)\b/,
  /\bopen to (candidates|applicants) (located |based )?in (the )?(us|usa|united states|canada|uk|europe|emea|latam)( only)?\b/,
];

export function workAuthBlock(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const t = norm(description);
  for (const re of WORK_AUTH_RES) {
    const m = re.exec(t);
    if (m) return m[0];
  }
  return undefined;
}

/** Pay range if the posting states one (display only, never used to filter). */
export function extractPay(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const patterns = [
    /(?:₹|inr|rs\.?)\s?[\d,.]+\s?(?:l|lpa|lakhs?|lacs?|cr)?(?:\s?(?:-|–|to)\s?(?:₹|inr|rs\.?)?\s?[\d,.]+\s?(?:l|lpa|lakhs?|lacs?|cr)?)?/i,
    /\b\d+(?:\.\d+)?\s?(?:-|–|to)\s?\d+(?:\.\d+)?\s?(?:lpa|lakhs?|lacs?)\b/i,
    /\$\s?\d{2,3}(?:,\d{3})+(?:\.\d{2})?(?:\s?(?:-|–|to)\s?\$\s?\d{2,3}(?:,\d{3})+(?:\.\d{2})?)?(?:\s?(?:usd|per year|\/yr|annually))?/i,
  ];
  for (const re of patterns) {
    const m = re.exec(description);
    if (m && /\d{2}/.test(m[0])) return m[0].trim();
  }
  return undefined;
}

/** True when visa sponsorship or relocation is offered (negations excluded). */
export function visaOrRelocation(description: string | undefined): boolean {
  if (!description) return false;
  const t = norm(description);
  if (/\b(no|not|unable to|cannot|can't|will not|won't|does not|do not)\b[^.]{0,40}\b(sponsor\w*|relocat\w*)/.test(t)) return false;
  return /\b(visa sponsorship|sponsor (a |your )?visa|relocation (assistance|support|package|bonus|provided|available|offered)|relocation is (provided|available|offered))\b/.test(t);
}
