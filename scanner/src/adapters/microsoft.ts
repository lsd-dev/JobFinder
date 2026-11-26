import type { Adapter, AdapterContext, RawJob } from "../types.js";
import { getJson } from "../http.js";
import { htmlToText } from "../text.js";

/**
 * Microsoft careers (Eightfold "pcsx" search API behind apply.careers.microsoft.com).
 * Undocumented: field names are read defensively and the weekly health check
 * flags it if the shape changes.
 */
interface MsPosition {
  id?: number | string;
  displayJobId?: string;
  name?: string;
  title?: string;
  location?: string;
  locations?: string[];
  standardizedLocations?: string[];
  postedTs?: number;
  creationTs?: number;
  positionUrl?: string;
  canonicalPositionUrl?: string;
  workLocationOption?: string;
  jobDescription?: string;
}

const PAGE = 10;
const MAX_PAGES = 4;
const BASE = "https://apply.careers.microsoft.com";

export function microsoft(): Adapter {
  return {
    complete: false,
    async list(ctx: AdapterContext) {
      const out: RawJob[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = `${BASE}/api/pcsx/search?domain=microsoft.com&query=software%20engineer&location=India&start=${page * PAGE}&sort_by=timestamp`;
        const data = await getJson<{ data?: { positions?: MsPosition[] } }>(url, {
          headers: { Referer: `${BASE}/careers?domain=microsoft.com` },
        });
        const jobs = (data.data?.positions ?? []).map(toRaw).filter((j) => j.externalId);
        out.push(...jobs);
        if (jobs.length < PAGE || jobs.some((j) => ctx.isSeen(j.externalId))) break;
      }
      return out;
    },
  };
}

export function toRaw(p: MsPosition): RawJob {
  const id = String(p.id ?? p.displayJobId ?? "");
  const locs = p.standardizedLocations?.length ? p.standardizedLocations : p.locations?.length ? p.locations : p.location ? [p.location] : [];
  const ts = p.postedTs ?? p.creationTs;
  const path = p.canonicalPositionUrl ?? p.positionUrl;
  return {
    externalId: id,
    title: (p.name ?? p.title ?? "").trim(),
    locations: locs,
    url: path ? new URL(path, BASE).toString() : `${BASE}/careers/job/${id}`,
    postedAt: ts ? new Date(ts * (ts < 1e12 ? 1000 : 1)).toISOString() : undefined,
    description: p.jobDescription ? htmlToText(p.jobDescription) : undefined,
    remoteHint: /remote/i.test(p.workLocationOption ?? ""),
  };
}
