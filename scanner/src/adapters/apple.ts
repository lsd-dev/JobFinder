import type { Adapter, AdapterContext, RawJob } from "../types.js";
import { request } from "../http.js";

/**
 * Apple Jobs. The search page embeds its data via
 * `window.__staticRouterHydrationData = JSON.parse("...")`;
 * jobs live at loaderData.search.searchResults (verified 2026-11-26).
 */
interface AppleResult {
  positionId?: string;
  id?: string;
  postingTitle?: string;
  transformedPostingTitle?: string;
  postDateInGMT?: string;
  jobSummary?: string;
  homeOffice?: boolean;
  locations?: { city?: string; name?: string; countryName?: string }[];
}

const MAX_PAGES = 3;

export function parseApplePage(html: string): RawJob[] {
  const m = /__staticRouterHydrationData = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/.exec(html);
  if (!m) throw new Error("apple: hydration data not found (page format changed?)");
  const hydration = JSON.parse(JSON.parse(m[1]!) as string) as { loaderData?: { search?: { searchResults?: AppleResult[] } } };
  const results = hydration.loaderData?.search?.searchResults ?? [];
  return results.map((r): RawJob => {
    const id = String(r.positionId ?? r.id ?? "");
    const locs = (r.locations ?? []).map((l) => (l.city ? `${l.city}, ${l.countryName ?? ""}` : l.name ?? "")).filter(Boolean);
    return {
      externalId: id,
      title: (r.postingTitle ?? "").trim(),
      locations: locs,
      url: `https://jobs.apple.com/en-in/details/${id}/${r.transformedPostingTitle ?? ""}`,
      postedAt: r.postDateInGMT,
      description: r.jobSummary,
      remoteHint: r.homeOffice === true,
    };
  });
}

export function apple(): Adapter {
  return {
    complete: false,
    async list(ctx: AdapterContext) {
      const out: RawJob[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `https://jobs.apple.com/en-in/search?location=india-INDC&sort=newest&search=software%20engineer&page=${page}`;
        const jobs = parseApplePage(await request(url));
        out.push(...jobs);
        if (jobs.length < 20 || jobs.some((j) => ctx.isSeen(j.externalId))) break;
      }
      return out;
    },
  };
}
