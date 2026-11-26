import type { SourceConfig } from "../types";

export interface Detected {
  source: SourceConfig;
  /** Human-readable summary shown before saving. */
  label: string;
  /** Public JSON endpoint the dashboard can call to count open jobs, when one exists. */
  testUrl?: string;
}

const SLUG = /^[A-Za-z0-9_-]+$/;

/**
 * Work out which applicant-tracking system a pasted careers URL belongs to.
 * Only the systems the scanner has generic adapters for are recognised;
 * anything else returns null and is saved as "pending".
 */
export function detectAts(input: string): Detected | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io" || host === "boards.eu.greenhouse.io" || host === "job-boards.eu.greenhouse.io") {
    const board = parts[0] === "embed" ? url.searchParams.get("for") : parts[0];
    if (!board || !SLUG.test(board)) return null;
    return {
      source: { kind: "greenhouse", board },
      label: `Greenhouse board "${board}"`,
      testUrl: `https://boards-api.greenhouse.io/v1/boards/${board}/jobs`,
    };
  }

  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const site = parts[0];
    if (!site || !SLUG.test(site)) return null;
    // The scanner's Lever adapter uses the global API host only.
    if (host === "jobs.eu.lever.co") return null;
    return { source: { kind: "lever", site }, label: `Lever site "${site}"`, testUrl: `https://api.lever.co/v0/postings/${site}?mode=json` };
  }

  if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
    const company = parts[0];
    if (!company || !SLUG.test(company)) return null;
    return {
      source: { kind: "smartrecruiters", company },
      label: `SmartRecruiters company "${company}"`,
      testUrl: `https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=1`,
    };
  }

  const wd = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/.exec(host);
  if (wd) {
    // Path is /{site} or /{locale}/{site}, e.g. /en-US/External_Career_Site
    const site = parts.find((p) => !/^[a-z]{2}-[A-Z]{2}$/.test(p));
    if (!site || !SLUG.test(site)) return null;
    return { source: { kind: "workday", host, tenant: wd[1]!, site }, label: `Workday site "${site}" (${wd[1]})` };
  }

  return null;
}

/** "Acme Corp, Inc." -> "acme-corp-inc" */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
