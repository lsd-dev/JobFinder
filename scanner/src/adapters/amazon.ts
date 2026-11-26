import type { Adapter, AdapterContext, RawJob } from "../types.js";
import { getJson } from "../http.js";
import { htmlToText } from "../text.js";

interface AmazonJob {
  id_icims: string;
  title: string;
  job_path: string;
  city?: string;
  location?: string;
  normalized_location?: string;
  posted_date?: string; // "November 26, 2026"
  basic_qualifications?: string;
  preferred_qualifications?: string;
  description?: string;
}

const PAGE = 50;
const MAX_PAGES = 3;

/** amazon.jobs search JSON: India, Software Development category, newest first. */
export function amazon(): Adapter {
  return {
    complete: false,
    async list(ctx: AdapterContext) {
      const out: RawJob[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const url =
          "https://www.amazon.jobs/en/search.json?country=IND&category%5B%5D=software-development" +
          `&sort=recent&result_limit=${PAGE}&offset=${page * PAGE}`;
        const data = await getJson<{ jobs?: AmazonJob[] }>(url);
        const jobs = (data.jobs ?? []).map(toRaw);
        out.push(...jobs);
        // Sorted by recency, so one already-seen job means the rest are older.
        if (jobs.length < PAGE || jobs.some((j) => ctx.isSeen(j.externalId))) break;
      }
      return out;
    },
  };
}

export function toRaw(j: AmazonJob): RawJob {
  const posted = j.posted_date ? new Date(`${j.posted_date} 00:00 UTC`) : undefined;
  return {
    externalId: j.id_icims,
    title: j.title.trim(),
    locations: [j.normalized_location ?? j.location ?? j.city ?? ""].filter(Boolean),
    url: `https://www.amazon.jobs${j.job_path}`,
    postedAt: posted && !Number.isNaN(posted.getTime()) ? posted.toISOString() : undefined,
    // Basic qualifications first: they carry the minimum years.
    description: [htmlToText(j.basic_qualifications), htmlToText(j.description), htmlToText(j.preferred_qualifications)].join("\n").trim(),
  };
}
