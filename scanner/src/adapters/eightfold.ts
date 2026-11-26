import type { Adapter, AdapterContext, RawJob } from "../types.js";
import { getJson } from "../http.js";
import { htmlToText } from "../text.js";

/**
 * Eightfold career sites ("pcsx" API), e.g. nvidia.eightfold.ai and
 * paypal.eightfold.ai. Their robots.txt allows /api/pcsx. Used for companies
 * whose Workday site rejects requests from GitHub's servers. Undocumented, so
 * fields are read defensively.
 */
export interface EightfoldConfig {
  /** e.g. "nvidia.eightfold.ai" */
  host: string;
  /** e.g. "nvidia.com" */
  domain: string;
  /** Search text; results are still sorted newest first. */
  query?: string;
}

export interface EfPosition {
  id?: number | string;
  displayJobId?: string;
  name?: string;
  locations?: string[];
  standardizedLocations?: string[];
  postedTs?: number;
  creationTs?: number;
  positionUrl?: string;
  publicUrl?: string;
  workLocationOption?: string;
  jobDescription?: string;
}

const PAGE = 10; // fixed by the API
const MAX_PAGES = 5;

export function eightfold(cfg: EightfoldConfig): Adapter {
  const base = `https://${cfg.host}`;
  const common = `domain=${encodeURIComponent(cfg.domain)}`;
  const http = { headers: { Referer: `${base}/careers?${common}` } };
  return {
    complete: false,
    async list(ctx: AdapterContext) {
      const out: RawJob[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = `${base}/api/pcsx/search?${common}&query=${encodeURIComponent(cfg.query ?? "software engineer")}&location=India&start=${page * PAGE}&sort_by=timestamp`;
        const data = await getJson<{ data?: { positions?: EfPosition[] } }>(url, http);
        const jobs = (data.data?.positions ?? []).map((p) => toRaw(base, p)).filter((j) => j.externalId && j.title);
        out.push(...jobs);
        // Newest first: one already-seen job means the rest are older.
        if (jobs.length < PAGE || jobs.some((j) => ctx.isSeen(j.externalId))) break;
      }
      return out;
    },
    async enrich(job) {
      const url = `${base}/api/pcsx/position_details?position_id=${encodeURIComponent(job.externalId)}&${common}&hl=en`;
      const d = await getJson<{ data?: EfPosition }>(url, http);
      return withDetail(job, d.data ?? {});
    },
  };
}

export function toRaw(base: string, p: EfPosition): RawJob {
  const id = String(p.id ?? "");
  const ts = p.postedTs ?? p.creationTs;
  return {
    externalId: id,
    title: (p.name ?? "").trim(),
    // "Bengaluru, KA, IN" style when present; otherwise the site's own text ("India, Bengaluru").
    locations: p.standardizedLocations?.length ? p.standardizedLocations : (p.locations ?? []),
    url: p.positionUrl ? new URL(p.positionUrl, base).toString() : `${base}/careers/job/${id}`,
    postedAt: ts ? new Date(ts * 1000).toISOString() : undefined,
    remoteHint: /remote/i.test(p.workLocationOption ?? ""),
  };
}

/** Adds the description and the company's own public link from the detail call. */
export function withDetail(job: RawJob, d: EfPosition): RawJob {
  const publicUrl = d.publicUrl && /^https:\/\//.test(d.publicUrl) ? d.publicUrl : undefined;
  return { ...job, description: htmlToText(d.jobDescription), url: publicUrl ?? job.url };
}
