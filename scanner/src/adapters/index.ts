import type { Adapter, Company } from "../types.js";
import { greenhouse } from "./greenhouse.js";
import { lever } from "./lever.js";
import { workday } from "./workday.js";
import { amazon } from "./amazon.js";
import { microsoft } from "./microsoft.js";
import { google } from "./google.js";
import { apple } from "./apple.js";
import { atlassian } from "./atlassian.js";
import { oracle } from "./oracle.js";

/** Build the adapter for a watchlist entry, or null if its source is not supported yet. */
export function adapterFor(c: Company): Adapter | null {
  const s = c.source;
  switch (s.kind) {
    case "greenhouse": return greenhouse(s.board);
    case "lever": return lever(s.site);
    case "workday": return workday(s);
    case "amazon": return amazon();
    case "microsoft": return microsoft();
    case "google": return google();
    case "apple": return apple();
    case "atlassian": return atlassian();
    case "oracle": return oracle(s);
    case "pending": return null;
  }
}
