import { describe, expect, it } from "vitest";
import { computePeak, inQuietHours, zonedParts, zonedTimeToUtc } from "../src/schedule/peak.js";
import { DEFAULT_SETTINGS } from "../src/config/profile.js";

const S = DEFAULT_SETTINGS;
const IST = "Asia/Kolkata";
/** Build a Date from an IST wall-clock time. */
const ist = (y: number, m: number, d: number, h: number, mi = 0) => new Date(zonedTimeToUtc(y, m, d, h, mi, IST));
const istStr = (d: Date) => {
  const p = zonedParts(d.getTime(), IST);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
};

describe("time zone helpers", () => {
  it("round-trips wall-clock times, including DST zones", () => {
    const t = zonedTimeToUtc(2026, 7, 15, 8, 0, "America/Los_Angeles"); // PDT, UTC-7
    expect(new Date(t).toISOString()).toBe("2026-07-15T15:00:00.000Z");
    const w = zonedTimeToUtc(2026, 12, 15, 8, 0, "America/Los_Angeles"); // PST, UTC-8
    expect(new Date(w).toISOString()).toBe("2026-12-15T16:00:00.000Z");
  });
  it("quiet hours wrap midnight", () => {
    expect(inQuietHours(ist(2026, 11, 26, 23, 30).getTime(), IST, S.quietHours)).toBe(true);
    expect(inQuietHours(ist(2026, 11, 27, 6, 59).getTime(), IST, S.quietHours)).toBe(true);
    expect(inQuietHours(ist(2026, 11, 27, 7, 0).getTime(), IST, S.quietHours)).toBe(false);
  });
});

describe("computePeak", () => {
  // 2026-11-26 is a Thursday.
  it("India job found Thursday afternoon -> Friday 08:00 IST", () => {
    const r = computePeak(ist(2026, 11, 26, 14, 0), IST, S);
    expect(istStr(r.remindAt)).toBe("2026-11-27 08:00");
    expect(r.applyNow).toBe(false);
  });

  it("India job found inside the window -> remind immediately", () => {
    const found = ist(2026, 11, 26, 9, 15);
    expect(computePeak(found, IST, S).remindAt.getTime()).toBe(found.getTime());
  });

  it("India job found Friday evening -> Monday 08:00, flagged apply-now (>24h)", () => {
    const r = computePeak(ist(2026, 11, 27, 18, 0), IST, S);
    expect(istStr(r.remindAt)).toBe("2026-11-30 08:00");
    expect(r.applyNow).toBe(true);
  });

  it("US Pacific job -> 08:00 PST, which is 21:30 IST (not in quiet hours)", () => {
    const r = computePeak(ist(2026, 11, 26, 12, 0), "America/Los_Angeles", S);
    expect(istStr(r.remindAt)).toBe("2026-11-26 21:30");
  });

  it("Sydney job whose window falls in IST night -> 22:45 IST the evening before", () => {
    // Fri 08:00 AEDT (UTC+11) = Fri 02:30 IST -> fallback Thu 22:45 IST.
    const r = computePeak(ist(2026, 11, 26, 12, 0), "Australia/Sydney", S);
    expect(istStr(r.windowStart)).toBe("2026-11-27 02:30");
    expect(istStr(r.remindAt)).toBe("2026-11-26 22:45");
  });

  it("Sydney job found after the evening fallback -> when quiet hours end", () => {
    const r = computePeak(ist(2026, 11, 26, 23, 30), "Australia/Sydney", S);
    expect(istStr(r.remindAt)).toBe("2026-11-27 07:00");
  });
});
