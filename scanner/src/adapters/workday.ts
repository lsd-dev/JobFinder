import type { Adapter, AdapterContext, RawJob } from "../types.js";
import { getJson } from "../http.js";
import { htmlToText } from "../text.js";

interface WdFacetValue { id: string; descriptor: string; count?: number; values?: WdFacetValue[] }
interface WdFacet { facetParameter: string; descriptor?: string; values?: WdFacetValue[] }
interface WdPosting { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] }
interface WdList { total?: number; jobPostings?: WdPosting[]; facets?: WdFacet[] }
interface WdDetail {
  jobPostingInfo?: { jobDescription?: string; location?: string; additionalLocations?: string[]; startDate?: string; remoteType?: string };
}

const PAGE = 20;
const MAX_PAGES = 5;
/**
 * Workday throttles by client IP across tenants (verified: 429s on every tenant
 * after a burst, regardless of headers). One shared queue with a long gap, and
 * no 429 retries: a throttled tenant is skipped for this run and retried next run.
 */
const WD_HTTP = { queueKey: "myworkdayjobs", minGapMs: 5000, retryOn429: false } as const;

/** "Posted Today" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" to an approximate ISO date. */
export function parsePostedOn(s: string | undefined, now = new Date()): string | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();
  const day = 86_400_000;
  if (t.includes("today")) return new Date(now.getTime()).toISOString();
  if (t.includes("yesterday")) return new Date(now.getTime() - day).toISOString();
  const m = /(\d+)\+?\s*days?/.exec(t);
  return m ? new Date(now.getTime() - Number(m[1]) * day).toISOString() : undefined;
}

/** Find the facet value that restricts results to India (facet ids differ per tenant). */
export function indiaFacet(facets: WdFacet[] | undefined): Record<string, string[]> | undefined {
  const walk = (vals: WdFacetValue[] | undefined): string | undefined => {
    for (const v of vals ?? []) {
      if (/^india$/i.test(v.descriptor.trim())) return v.id;
      const inner = walk(v.values);
      if (inner) return inner;
    }
    return undefined;
  };
  // Prefer an explicit country facet; fall back to any facet containing "India".
  const ordered = [...(facets ?? [])].sort((a, b) => Number(/country/i.test(b.facetParameter)) - Number(/country/i.test(a.facetParameter)));
  for (const f of ordered) {
    const id = walk(f.values);
    if (id) return { [f.facetParameter]: [id] };
  }
  return undefined;
}

/**
 * Workday CXS endpoint (the JSON API behind every *.myworkdayjobs.com site).
 * Undocumented and rate-limited, so: an India facet to keep results small,
 * newest-first paging that stops once a whole page is already known, and the
 * detail call only for jobs that pass the title gate.
 */
export function workday(cfg: { host: string; tenant: string; site: string; searchText?: string; indiaFacet?: Record<string, string[]> }): Adapter {
  const api = `https://${cfg.host}/wday/cxs/${cfg.tenant}/${cfg.site}`;
  const body = (offset: number, facets: Record<string, string[]>) => ({ appliedFacets: facets, limit: PAGE, offset, searchText: cfg.searchText ?? "" });

  return {
    complete: false,
    async list(ctx: AdapterContext) {
      // Use the cached India facet when the watchlist has one (saves a request per run);
      // otherwise discover it from the first, unfiltered page and log it for caching.
      let facets = cfg.indiaFacet;
      let first: WdList | undefined;
      if (!facets) {
        first = await getJson<WdList>(`${api}/jobs`, { json: body(0, {}), ...WD_HTTP });
        facets = indiaFacet(first.facets);
        ctx.log(facets ? `workday: discovered India facet ${JSON.stringify(facets)} (add to watchlist as indiaFacet)` : "workday: no India facet found, scanning unfiltered");
      }
      const out: RawJob[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const reuseFirst = page === 0 && first && !facets;
        const data = reuseFirst ? first! : await getJson<WdList>(`${api}/jobs`, { json: body(page * PAGE, facets ?? {}), ...WD_HTTP });
        const posts = data.jobPostings ?? [];
        const jobs = posts.map((p) => toRaw(cfg, p));
        out.push(...jobs);
        if (posts.length < PAGE || jobs.every((j) => ctx.isSeen(j.externalId))) break;
      }
      return out;
    },
    async enrich(job) {
      const path = new URL(job.url).pathname.replace(`/${cfg.site}`, "");
      const d = await getJson<WdDetail>(`${api}${path}`, WD_HTTP);
      const info = d.jobPostingInfo ?? {};
      const locs = [info.location, ...(info.additionalLocations ?? [])].filter((x): x is string => !!x);
      return {
        ...job,
        description: htmlToText(info.jobDescription),
        locations: locs.length ? locs : job.locations,
        postedAt: info.startDate ? new Date(info.startDate).toISOString() : job.postedAt,
        remoteHint: job.remoteHint || /remote/i.test(info.remoteType ?? ""),
      };
    },
  };
}

function toRaw(cfg: { host: string; site: string }, p: WdPosting): RawJob {
  return {
    externalId: p.bulletFields?.[0] ?? p.externalPath,
    title: p.title.trim(),
    locations: p.locationsText ? [p.locationsText] : [],
    url: `https://${cfg.host}/${cfg.site}${p.externalPath}`,
    postedAt: parsePostedOn(p.postedOn),
  };
}
