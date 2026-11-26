import type { Adapter, AdapterContext, RawJob } from "../types.js";
import { getJson } from "../http.js";

interface OracleReq {
  Id: string;
  Title: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  WorkplaceType?: string;
  WorkplaceTypeCode?: string | null;
  ShortDescriptionStr?: string;
  secondaryLocations?: { Name?: string }[];
}

const PAGE = 25;
const MAX_PAGES = 3;

/** Oracle Cloud HCM candidate-experience REST API (used by careers.oracle.com). */
export function oracle(cfg: { host: string; siteNumber: string; publicBase: string }): Adapter {
  return {
    complete: false,
    async list(ctx: AdapterContext) {
      const out: RawJob[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const finder = `findReqs;siteNumber=${cfg.siteNumber},keyword=software,limit=${PAGE},offset=${page * PAGE},sortBy=POSTING_DATES_DESC`;
        const url = `https://${cfg.host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`;
        const data = await getJson<{ items?: { requisitionList?: OracleReq[] }[] }>(url);
        const reqs = data.items?.[0]?.requisitionList ?? [];
        const jobs = reqs.map((r) => toRaw(cfg.publicBase, r));
        // Keep India and remote roles; the location matcher does the final check.
        out.push(...jobs.filter((_, i) => reqs[i]!.PrimaryLocationCountry === "IN" || /remote/i.test(reqs[i]!.WorkplaceType ?? "")));
        if (reqs.length < PAGE || jobs.some((j) => ctx.isSeen(j.externalId))) break;
      }
      return out;
    },
  };
}

export function toRaw(publicBase: string, r: OracleReq): RawJob {
  const locs = [r.PrimaryLocation, ...(r.secondaryLocations ?? []).map((s) => s.Name)].filter((x): x is string => !!x);
  return {
    externalId: r.Id,
    title: r.Title.trim(),
    locations: locs,
    url: `${publicBase}${r.Id}`,
    postedAt: r.PostedDate ? new Date(`${r.PostedDate}T00:00:00Z`).toISOString() : undefined,
    description: r.ShortDescriptionStr,
    remoteHint: /remote/i.test(r.WorkplaceType ?? r.WorkplaceTypeCode ?? ""),
  };
}
