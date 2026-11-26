import { describe, expect, it } from "vitest";
import { parseGooglePage } from "../src/adapters/google.js";
import { parseApplePage } from "../src/adapters/apple.js";
import { toRaw as ghRaw, splitLocations } from "../src/adapters/greenhouse.js";
import { toRaw as leverRaw } from "../src/adapters/lever.js";
import { toRaw as amazonRaw } from "../src/adapters/amazon.js";
import { toRaw as msRaw } from "../src/adapters/microsoft.js";
import { indiaFacet, parsePostedOn } from "../src/adapters/workday.js";
import { htmlToText } from "../src/text.js";

/**
 * Minimal fixtures that mirror the real response shapes observed on 2026-11-26.
 * They are hand-trimmed (a few fields per record) so the repo stays small.
 */

describe("google page parser", () => {
  const row = [
    "123", "Software Engineer II, Backend", "https://example/signin",
    [null, "<ul><li>Build services</li></ul>"], [null, "<h3>Minimum qualifications:</h3><ul><li>1 year of experience with Java.</li></ul>"],
    "projects/x/companies/y", null, "Google", "en-US",
    [["Bengaluru, Karnataka, India", ["addr"], "Bengaluru"]], [null, "about"], [2],
    [1795678593, 600000000],
  ];
  const html = `<script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify([[row], null, 1, 20])}, sideChannel: {}});</script>`;

  it("extracts id, title, location, created date and qualifications first", () => {
    const [j] = parseGooglePage(html);
    expect(j).toMatchObject({ externalId: "123", title: "Software Engineer II, Backend", locations: ["Bengaluru, Karnataka, India"] });
    expect(j!.url).toBe("https://www.google.com/about/careers/applications/jobs/results/123");
    expect(j!.postedAt).toBe(new Date(1795678593000).toISOString());
    expect(j!.description!.startsWith("Minimum qualifications")).toBe(true);
  });

  it("throws a clear error when the page format changes", () => {
    expect(() => parseGooglePage("<html></html>")).toThrow(/format changed/);
  });
});

describe("apple page parser", () => {
  const data = {
    loaderData: {
      search: {
        searchResults: [
          {
            positionId: "200600001", postingTitle: "Software Engineer - Services", transformedPostingTitle: "software-engineer-services",
            postDateInGMT: "2026-11-26T10:52:34Z", jobSummary: "Build backend services.", homeOffice: false,
            locations: [{ city: "Hyderabad", countryName: "India", name: "Hyderabad" }],
          },
        ],
      },
    },
  };
  const html = `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify(data))});</script>`;

  it("decodes the double-encoded hydration JSON", () => {
    const [j] = parseApplePage(html);
    expect(j).toMatchObject({ externalId: "200600001", locations: ["Hyderabad, India"], postedAt: "2026-11-26T10:52:34Z" });
    expect(j!.url).toBe("https://jobs.apple.com/en-in/details/200600001/software-engineer-services");
  });
});

describe("greenhouse", () => {
  it("maps list records and splits multi-location strings", () => {
    const j = ghRaw({ id: 42, title: " Backend Engineer ", absolute_url: "https://x/42", location: { name: "Bengaluru, India; Remote - India" }, first_published: "2026-11-25T10:00:00Z" });
    expect(j).toMatchObject({ externalId: "42", title: "Backend Engineer", locations: ["Bengaluru, India", "Remote - India"] });
    expect(splitLocations("Pune | Hyderabad")).toEqual(["Pune", "Hyderabad"]);
  });
  it("decodes Greenhouse's entity-escaped HTML content", () => {
    expect(htmlToText("&lt;p&gt;2+ years of experience&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Node.js&lt;/li&gt;&lt;/ul&gt;")).toBe("2+ years of experience\nNode.js");
  });
});

describe("lever", () => {
  it("puts requirement lists before the description and reads remote", () => {
    const j = leverRaw({
      id: "abc", text: "Software Engineer", hostedUrl: "https://jobs.lever.co/x/abc", createdAt: 1787308401605, workplaceType: "remote",
      categories: { allLocations: ["Bengaluru"] }, descriptionPlain: "About us", lists: [{ text: "Requirements", content: "<li>1+ years of experience</li>" }],
    });
    expect(j.remoteHint).toBe(true);
    expect(j.description!.indexOf("1+ years")).toBeLessThan(j.description!.indexOf("About us"));
  });
});

describe("amazon", () => {
  it("parses posted_date and builds the job URL", () => {
    const j = amazonRaw({ id_icims: "10613775", title: "Software Development Engineer", job_path: "/en/jobs/10613775/sde", normalized_location: "Hyderabad, Telangana, IND", posted_date: "November 26, 2026", basic_qualifications: "- 1+ years of experience" });
    expect(j.url).toBe("https://www.amazon.jobs/en/jobs/10613775/sde");
    expect(j.postedAt?.slice(0, 10)).toBe("2026-11-26");
    expect(j.description!.startsWith("- 1+ years")).toBe(true);
  });
});

describe("microsoft", () => {
  it("handles second and millisecond timestamps and relative URLs", () => {
    const a = msRaw({ id: 1970, name: "Software Engineer", locations: ["Hyderabad, Telangana, India"], postedTs: 1795678593, positionUrl: "/careers/job/1970" });
    expect(a.url).toBe("https://apply.careers.microsoft.com/careers/job/1970");
    expect(a.postedAt).toBe(new Date(1795678593000).toISOString());
    expect(msRaw({ id: 2, name: "x", postedTs: 1795678593000 }).postedAt).toBe(new Date(1795678593000).toISOString());
  });
});

describe("workday helpers", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  it("parses relative posted dates", () => {
    expect(parsePostedOn("Posted Today", now)).toBe(now.toISOString());
    expect(parsePostedOn("Posted Yesterday", now)?.slice(0, 10)).toBe("2026-11-25");
    expect(parsePostedOn("Posted 3 Days Ago", now)?.slice(0, 10)).toBe("2026-11-23");
    expect(parsePostedOn("Posted 30+ Days Ago", now)?.slice(0, 10)).toBe("2026-10-27");
  });
  it("finds the India facet, preferring a country facet", () => {
    const facets = [
      { facetParameter: "locations", values: [{ id: "loc-blr", descriptor: "Bangalore" }] },
      { facetParameter: "locationHierarchy1", values: [{ id: "x", descriptor: "Asia", values: [{ id: "in-1", descriptor: "India" }] }] },
      { facetParameter: "Location_Country", values: [{ id: "in-2", descriptor: "India" }] },
    ];
    expect(indiaFacet(facets)).toEqual({ Location_Country: ["in-2"] });
    expect(indiaFacet([])).toBeUndefined();
  });
});
