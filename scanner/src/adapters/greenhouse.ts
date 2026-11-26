import type { Adapter, RawJob } from "../types.js";
import { getJson } from "../http.js";
import { htmlToText } from "../text.js";

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  offices?: { name?: string; location?: string | null }[];
  first_published?: string;
  updated_at?: string;
  content?: string;
}

/** Split "Bengaluru, India; Remote - India" style strings into separate locations. */
export function splitLocations(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(/\s*(?:;|\||\bor\b)\s*/i).map((x) => x.trim()).filter(Boolean);
}

/** Greenhouse public Job Board API. Returns every open job in one call. */
export function greenhouse(board: string): Adapter {
  const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}`;
  return {
    complete: true,
    async list() {
      const data = await getJson<{ jobs: GhJob[] }>(`${base}/jobs`);
      return data.jobs.map((j): RawJob => toRaw(j));
    },
    async enrich(job) {
      const j = await getJson<GhJob>(`${base}/jobs/${job.externalId}`);
      const full = toRaw(j);
      return { ...job, description: htmlToText(j.content), locations: full.locations.length ? full.locations : job.locations };
    },
  };
}

export function toRaw(j: GhJob): RawJob {
  const locs = new Set(splitLocations(j.location?.name));
  for (const o of j.offices ?? []) if (o.location) locs.add(o.location);
  return {
    externalId: String(j.id),
    title: j.title.trim(),
    locations: [...locs],
    url: j.absolute_url,
    postedAt: j.first_published ?? undefined,
    description: j.content ? htmlToText(j.content) : undefined,
  };
}
