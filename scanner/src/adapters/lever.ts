import type { Adapter, RawJob } from "../types.js";
import { getJson } from "../http.js";
import { htmlToText } from "../text.js";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[] };
  descriptionPlain?: string;
  lists?: { text?: string; content?: string }[];
  additionalPlain?: string;
}

/** Lever public postings API. Returns every open job in one call, descriptions included. */
export function lever(site: string): Adapter {
  return {
    complete: true,
    async list() {
      const data = await getJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`);
      return data.map(toRaw);
    },
  };
}

export function toRaw(p: LeverPosting): RawJob {
  const locs = p.categories?.allLocations?.length ? p.categories.allLocations : p.categories?.location ? [p.categories.location] : [];
  const lists = (p.lists ?? []).map((l) => `${l.text ?? ""}\n${htmlToText(l.content)}`).join("\n");
  return {
    externalId: p.id,
    title: p.text.trim(),
    locations: locs,
    url: p.hostedUrl,
    postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
    // Requirements lists first: they carry the "N years" minimum.
    description: [lists, p.descriptionPlain ?? "", p.additionalPlain ?? ""].join("\n").trim(),
    remoteHint: p.workplaceType === "remote",
  };
}
