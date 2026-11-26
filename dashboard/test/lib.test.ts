import { describe, expect, it } from "vitest";
import { detectAts, slugify } from "../src/lib/detectAts";
import { ago, applyFilters, countViews, DEFAULT_FILTERS, followUpDue, linkedInSearch, peakLabel, viewOf } from "../src/lib/jobs";
import { isValidKey, keyFromHash } from "../src/lib/key";
import type { StoredJob } from "../src/types";

const NOW = new Date("2026-11-26T12:00:00Z");
const job = (p: Partial<StoredJob> = {}): StoredJob => ({
  id: "acme_1", companyId: "acme", companyName: "Acme", externalId: "1", title: "Backend Engineer I", location: "Bengaluru", remote: false,
  url: "https://acme.example/jobs/1", firstSeenAt: "2026-11-26T10:00:00.000Z", tier: "A", score: 80, reasons: [], keywords: [{ term: "kafka", onResume: false }],
  recruiterTimeZone: "Asia/Kolkata", peakAt: "2026-11-27T02:30:00.000Z", applyNow: false, repostKey: "k", reposted: false, baseline: false, priority: false,
  status: "not_applied", closed: false, ...p,
});

describe("detectAts", () => {
  it("recognises Greenhouse, Lever, SmartRecruiters and Workday URLs", () => {
    expect(detectAts("https://boards.greenhouse.io/stripe")?.source).toEqual({ kind: "greenhouse", board: "stripe" });
    expect(detectAts("https://job-boards.greenhouse.io/gitlab/jobs/123")?.source).toEqual({ kind: "greenhouse", board: "gitlab" });
    expect(detectAts("https://boards.greenhouse.io/embed/job_board?for=coinbase")?.source).toEqual({ kind: "greenhouse", board: "coinbase" });
    expect(detectAts("https://jobs.lever.co/cred/abc-123")?.source).toEqual({ kind: "lever", site: "cred" });
    expect(detectAts("https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site")?.source).toEqual({
      kind: "workday", host: "salesforce.wd12.myworkdayjobs.com", tenant: "salesforce", site: "External_Career_Site",
    });
    expect(detectAts("https://jobs.smartrecruiters.com/ExampleCo/123-engineer")?.source).toEqual({ kind: "smartrecruiters", company: "ExampleCo" });
    expect(detectAts("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/x")?.source).toMatchObject({ site: "NVIDIAExternalCareerSite" });
  });

  it("rejects everything else", () => {
    for (const u of ["", "not a url", "http://boards.greenhouse.io/stripe", "https://careers.example.com/jobs", "https://boards.greenhouse.io/", "https://evil.example/boards.greenhouse.io/stripe", "https://jobs.lever.co/a%2Fb"]) {
      expect(detectAts(u), u).toBeNull();
    }
  });

  it("builds slugs", () => {
    expect(slugify("  Acme Corp, Inc. ")).toBe("acme-corp-inc");
  });
});

describe("job lists", () => {
  const jobs = [
    job({ id: "a" }),
    job({ id: "b", status: "applied", appliedAt: "2026-11-18T12:00:00.000Z", closed: true }),
    job({ id: "c", status: "not_interested" }),
    job({ id: "d", closed: true }),
    job({ id: "e", tier: "Maybe", remote: true, location: "Remote (global)", firstSeenAt: "2026-11-26T11:00:00.000Z" }),
  ];

  it("puts each job in exactly one list; applied wins over closed", () => {
    expect(jobs.map(viewOf)).toEqual(["todo", "applied", "hidden", "closed", "todo"]);
    expect(countViews(jobs)).toEqual({ todo: 2, applied: 1, hidden: 1, closed: 1 });
  });

  it("filters and sorts", () => {
    expect(applyFilters(jobs, DEFAULT_FILTERS).map((j) => j.id)).toEqual(["e", "a"]); // newest first
    expect(applyFilters(jobs, { ...DEFAULT_FILTERS, sort: "score" }).map((j) => j.id)).toEqual(["a", "e"]);
    expect(applyFilters(jobs, { ...DEFAULT_FILTERS, remoteOnly: true }).map((j) => j.id)).toEqual(["e"]);
    expect(applyFilters(jobs, { ...DEFAULT_FILTERS, tiers: new Set(["A"]) }).map((j) => j.id)).toEqual(["a"]);
    expect(applyFilters(jobs, { ...DEFAULT_FILTERS, query: "KAFKA" })).toHaveLength(2);
    expect(applyFilters(jobs, { ...DEFAULT_FILTERS, query: "nomatch" })).toHaveLength(0);
    expect(applyFilters(jobs, { ...DEFAULT_FILTERS, companyId: "other" })).toHaveLength(0);
  });

  it("follow-up, age and peak labels", () => {
    expect(followUpDue(jobs[1]!, 6, NOW)).toBe(true);
    expect(followUpDue(jobs[1]!, 10, NOW)).toBe(false);
    expect(ago("2026-11-26T11:30:00Z", NOW)).toBe("30 min ago");
    expect(ago("2026-11-24T12:00:00Z", NOW)).toBe("2 d ago");
    expect(peakLabel(job(), NOW)).toMatchObject({ urgent: false });
    expect(peakLabel(job({ peakAt: "2026-11-26T03:00:00.000Z" }), NOW)).toMatchObject({ urgent: true });
    expect(peakLabel(job({ applyNow: true }), NOW)?.text).toMatch(/Apply now/);
    expect(peakLabel(job({ status: "applied" }), NOW)).toBeNull();
  });

  it("LinkedIn links are plain encoded searches", () => {
    const u = new URL(linkedInSearch(job({ companyName: "A&B Co" }), "manager"));
    expect(u.origin).toBe("https://www.linkedin.com");
    expect(u.searchParams.get("keywords")).toBe("A&B Co engineering manager Bengaluru");
  });
});

describe("space key", () => {
  it("validates length and characters", () => {
    expect(isValidKey("a".repeat(32))).toBe(true);
    expect(isValidKey("a".repeat(31))).toBe(false);
    expect(isValidKey("a".repeat(31) + "/")).toBe(false);
    expect(keyFromHash("#k=" + "b".repeat(43))).toBe("b".repeat(43));
    expect(keyFromHash("#k=short")).toBeNull();
    expect(keyFromHash("#other")).toBeNull();
  });
});
