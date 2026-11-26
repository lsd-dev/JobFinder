import type { Adapter, AdapterContext, RawJob } from "../types.js";
import { request } from "../http.js";
import { htmlToText } from "../text.js";

/**
 * Google Careers. There is no public API; the results page embeds the job list
 * as a JSON array in `AF_initDataCallback({key: 'ds:1', ...})`. Positional
 * fields (verified 2026-11-26):
 *   [0] id  [1] title  [3][1] responsibilities HTML  [4][1] qualifications HTML
 *   [9] locations: [[display, ...], ...]  [12][0] created (epoch seconds)
 * Fragile by nature: the weekly health check alerts when parsing breaks.
 */
const MAX_PAGES = 3;

export function parseGooglePage(html: string): RawJob[] {
  const m = /AF_initDataCallback\(\{key: 'ds:1', hash: '\d+', data:([\s\S]*?), sideChannel: \{\}\}\);<\/script>/.exec(html);
  if (!m) throw new Error("google: ds:1 data block not found (page format changed?)");
  const data = JSON.parse(m[1]!) as unknown[];
  const rows = (data[0] ?? []) as unknown[][];
  return rows.map((r): RawJob => {
    const id = String(r[0]);
    const quals = htmlToText((r[4] as [unknown, string] | null)?.[1]);
    const resp = htmlToText((r[3] as [unknown, string] | null)?.[1]);
    const locs = ((r[9] as unknown[][] | null) ?? []).map((l) => String(l[0] ?? "")).filter(Boolean);
    const created = (r[12] as [number, number] | null)?.[0];
    return {
      externalId: id,
      title: String(r[1] ?? "").trim(),
      locations: locs,
      url: `https://www.google.com/about/careers/applications/jobs/results/${id}`,
      postedAt: created ? new Date(created * 1000).toISOString() : undefined,
      description: `${quals}\n${resp}`.trim(),
    };
  });
}

export function google(): Adapter {
  return {
    complete: false,
    async list(ctx: AdapterContext) {
      const out: RawJob[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url =
          "https://www.google.com/about/careers/applications/jobs/results/?location=India&q=software%20engineer" +
          `&target_level=EARLY&target_level=MID&sort_by=date&page=${page}`;
        const jobs = parseGooglePage(await request(url));
        out.push(...jobs);
        if (jobs.length < 20 || jobs.some((j) => ctx.isSeen(j.externalId))) break;
      }
      return out;
    },
  };
}
