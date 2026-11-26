import type { Adapter, RawJob } from "../types.js";
import { getJson } from "../http.js";
import { htmlToText } from "../text.js";

interface AtlassianListing {
  id: number;
  title: string;
  locations?: string[];
  category?: string;
  overview?: string;
  responsibilities?: string;
  qualifications?: string;
  applyUrl?: string;
  portalJobPost?: { updatedDate?: string };
}

/** Atlassian careers listings endpoint: every open job in one call. */
export function atlassian(): Adapter {
  return {
    complete: true,
    async list() {
      const data = await getJson<AtlassianListing[]>("https://www.atlassian.com/endpoint/careers/listings");
      return data.map(toRaw);
    },
  };
}

export function toRaw(j: AtlassianListing): RawJob {
  return {
    externalId: String(j.id),
    title: j.title.trim(),
    // "Bengaluru - India -   Bengaluru,  560071 India" -> keep as-is; the location matcher normalizes.
    locations: j.locations ?? [],
    url: `https://www.atlassian.com/company/careers/details/${j.id}`,
    // updatedDate is the only date given; it is when the post was last updated, not first posted.
    description: [htmlToText(j.qualifications), htmlToText(j.responsibilities), htmlToText(j.overview)].join("\n").trim(),
  };
}
