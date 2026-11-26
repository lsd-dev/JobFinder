import type { Adapter, RawJob } from "../types.js";
import { request } from "../http.js";
import { decodeEntities, htmlToText } from "../text.js";

/**
 * Radancy (TalentBrew) career sites, e.g. jobs.intuit.com.
 *
 * The site's search endpoint (/search-jobs/) is disallowed by robots.txt, so
 * it is not used. The sitemap lists every open job as
 *   https://{host}/job/{city}/{title-slug}/{companyId}/{jobId}
 * which is enough for the title and city gates. The real title, country,
 * posted date and description come from the job page's schema.org JobPosting
 * block, fetched only for jobs that pass the title gate.
 */
export function radancy(host: string): Adapter {
  return {
    complete: true,
    async list() {
      const jobs = parseSitemap(await request(`https://${host}/sitemap.xml`, { timeoutMs: 30_000 }), host);
      if (jobs.length === 0) throw new Error(`radancy: no job URLs in the ${host} sitemap (format changed?)`);
      return jobs;
    },
    async enrich(job) {
      return { ...job, ...parseJobPage(await request(job.url)) };
    },
  };
}

const ROMAN = /^(i{1,3}|iv|v)$/;
const SMALL = new Set(["and", "of", "for", "the", "in", "to", "at"]);

/** "senior-software-engineer-ii" -> "Senior Software Engineer II" (punctuation is lost in the slug). */
export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w, i) => (ROMAN.test(w) ? w.toUpperCase() : i > 0 && SMALL.has(w) ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

export function parseSitemap(xml: string, host: string): RawJob[] {
  const out: RawJob[] = [];
  const seen = new Set<string>();
  const re = /<loc>\s*(https:\/\/[^<\s]+\/job\/([a-z0-9-]+)\/([a-z0-9-]+)\/\d+\/(\d+))\s*<\/loc>/g;
  for (const m of xml.matchAll(re)) {
    const [, url, city, slug, id] = m as unknown as [string, string, string, string, string];
    if (new URL(url).host !== host || seen.has(id)) continue;
    seen.add(id);
    out.push({ externalId: id, title: titleFromSlug(slug), locations: [titleFromSlug(city)], url });
  }
  return out;
}

interface LdAddress { addressLocality?: string; addressRegion?: string; addressCountry?: string }
interface LdJobPosting {
  "@type"?: string;
  title?: string;
  datePosted?: string;
  description?: string;
  jobLocationType?: string;
  jobLocation?: { address?: LdAddress } | { address?: LdAddress }[];
}

/** Fields taken from the page's JobPosting block; empty when the block is missing. */
export function parseJobPage(html: string): Partial<RawJob> {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let ld: LdJobPosting;
    try {
      ld = JSON.parse(m[1]!) as LdJobPosting;
    } catch {
      continue;
    }
    if (ld["@type"] !== "JobPosting") continue;
    const places = Array.isArray(ld.jobLocation) ? ld.jobLocation : ld.jobLocation ? [ld.jobLocation] : [];
    const locations = places
      .map((p) => [p.address?.addressLocality, p.address?.addressRegion, p.address?.addressCountry].filter(Boolean).join(", "))
      .filter(Boolean);
    const posted = ld.datePosted ? new Date(ld.datePosted) : undefined;
    const out: Partial<RawJob> = { description: htmlToText(decodeEntities(ld.description ?? "")) };
    if (ld.title?.trim()) out.title = decodeEntities(ld.title).trim();
    if (locations.length) out.locations = locations;
    if (posted && !Number.isNaN(posted.getTime())) out.postedAt = posted.toISOString();
    if (ld.jobLocationType === "TELECOMMUTE") out.remoteHint = true;
    return out;
  }
  return {};
}
