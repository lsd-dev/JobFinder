import { describe, expect, it } from "vitest";
import { FAILING_AFTER, healthMessage, summarizeHealth } from "../src/health.js";
import type { CompanyHealth } from "../src/store/types.js";
import type { Company } from "../src/types.js";

const NOW = new Date("2026-11-26T12:00:00Z");
const company = (id: string, p: Partial<Company> = {}): Company => ({ id, name: id, enabled: true, hqTimeZone: "Asia/Kolkata", source: { kind: "amazon" }, ...p });
const health = (p: Partial<CompanyHealth> = {}): CompanyHealth => ({ lastScanAt: "2026-11-26T11:50:00.000Z", ok: true, consecutiveFailures: 0, fetched: 10, matchedNew: 0, ...p });

describe("weekly health check", () => {
  const companies = [
    company("a"),
    company("b"),
    company("c"),
    company("off", { enabled: false }),
    company("pending", { source: { kind: "pending", reason: "x" } }),
  ];

  it("is quiet when everything scans", () => {
    const s = summarizeHealth(companies, { a: health(), b: health(), c: health() }, NOW);
    expect(s).toEqual({ scanned: 3, failing: 0, neverScanned: 0, stale: false });
    expect(healthMessage(s)).toBeNull();
  });

  it("reports only long-running failures of enabled, supported companies", () => {
    const s = summarizeHealth(
      companies,
      {
        a: health({ ok: false, consecutiveFailures: FAILING_AFTER }),
        b: health({ ok: false, consecutiveFailures: 3 }), // a short blip
        off: health({ ok: false, consecutiveFailures: 500 }),
      },
      NOW,
    );
    expect(s).toEqual({ scanned: 3, failing: 1, neverScanned: 1, stale: false });
    expect(healthMessage(s)).toMatchObject({ title: "JobFinder: 1 career site is failing", link: "/?tab=health" });
  });

  it("flags a stopped schedule", () => {
    const old = health({ lastScanAt: "2026-11-26T08:00:00.000Z" });
    const s = summarizeHealth(companies, { a: old, b: old, c: old }, NOW);
    expect(s.stale).toBe(true);
    expect(healthMessage(s)?.title).toMatch(/stopped/);
    expect(summarizeHealth(companies, {}, NOW).stale).toBe(true);
    expect(summarizeHealth([], {}, NOW).stale).toBe(false);
  });
});
