import type { Adapter, AdapterContext, RawJob } from "../types.js";
import { getJson } from "../http.js";
import { htmlToText } from "../text.js";

interface SrLocation { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string }
interface SrPosting { id: string; name: string; releasedDate?: string; location?: SrLocation }
interface SrList { totalFound?: number; content?: SrPosting[] }
interface SrSection { text?: string }
interface SrDetail {
  postingUrl?: string;
  jobAd?: { sections?: { jobDescription?: SrSection; qualifications?: SrSection; additionalInformation?: SrSection } };
}

const PAGE = 100;
const MAX_PAGES = 10;

/**
 * SmartRecruiters public Posting API (documented, no key needed):
 * newest first, 100 per page. Small boards are read completely so closed jobs
 * can be detected; the description comes from a second call, made only for
 * jobs that pass the title gate.
 */
export function smartrecruiters(company: string): Adapter {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings`;
  return {
    complete: true,
    async list(_ctx: AdapterContext) {
      const out: RawJob[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await getJson<SrList>(`${base}?limit=${PAGE}&offset=${page * PAGE}`);
        const posts = data.content ?? [];
        out.push(...posts.map((p) => toRaw(company, p)));
        if (posts.length < PAGE || out.length >= (data.totalFound ?? 0)) return out;
      }
      // "complete" promises the whole list; a truncated one would mark open jobs closed.
      throw new Error(`smartrecruiters: more than ${MAX_PAGES * PAGE} postings for ${company}`);
    },
    async enrich(job) {
      const d = await getJson<SrDetail>(`${base}/${encodeURIComponent(job.externalId)}`);
      return { ...job, description: describe(d), url: d.postingUrl ?? job.url };
    },
  };
}

export function toRaw(company: string, p: SrPosting): RawJob {
  const loc = p.location ?? {};
  const text = loc.fullLocation ?? [loc.city, loc.region, loc.country].filter(Boolean).join(", ");
  return {
    externalId: p.id,
    title: p.name.trim(),
    locations: text ? [text] : [],
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${encodeURIComponent(p.id)}`,
    postedAt: p.releasedDate,
    remoteHint: loc.remote === true,
  };
}

/** Qualifications first: they carry the minimum years. The company blurb is left out. */
export function describe(d: SrDetail): string {
  const s = d.jobAd?.sections ?? {};
  return [htmlToText(s.qualifications?.text), htmlToText(s.jobDescription?.text), htmlToText(s.additionalInformation?.text)].join("\n").trim();
}
