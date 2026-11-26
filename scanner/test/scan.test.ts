import { describe, expect, it } from "vitest";
import type { Adapter, Company, RawJob } from "../src/types.js";
import { scanAll } from "../src/scan.js";
import { MemoryStore } from "../src/store/memory.js";
import { ConsoleNotifier } from "../src/notify/messages.js";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, isValidTimeZone, sanitizeSettings, type Settings } from "../src/config/profile.js";

const company: Company = { id: "acme", name: "Acme", enabled: true, priority: true, hqTimeZone: "America/Los_Angeles", source: { kind: "amazon" } };

const job = (id: string, title = "Backend Engineer I", locations = ["Bengaluru, India"]): RawJob => ({
  externalId: id, title, locations, url: `https://acme/jobs/${id}`, description: "1+ years of experience with Node.js, TypeScript and SQL.",
});

/** Fake adapter whose listing can change between runs. */
function fake(complete = true) {
  let jobs: RawJob[] = [];
  const adapter: Adapter = { complete, list: async () => jobs };
  return { adapter, set: (j: RawJob[]) => (jobs = j) };
}

function setup(complete = true) {
  const store = new MemoryStore();
  const notifier = new ConsoleNotifier();
  const src = fake(complete);
  let now = new Date("2026-11-26T08:30:00Z"); // Thu 14:00 IST
  const run = () =>
    scanAll([company], { store, notifier, profile: DEFAULT_PROFILE, settings: DEFAULT_SETTINGS, now: () => now, adapterFor: () => src.adapter });
  return { store, notifier, src, run, setNow: (d: Date) => (now = d) };
}

describe("settings from the dashboard", () => {
  it("accepts real time zones only", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Asia/Calcutta")).toBe(true); // older name some browsers still list
    expect(isValidTimeZone("Asia/Kolkatta")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });

  it("replaces unusable values with the defaults and keeps good ones", () => {
    const s = sanitizeSettings({
      userTimeZone: "nope", quietHours: { start: "22:00", end: "7am" }, eveningFallback: "21:30", followUpDays: 0, maxYears: 3,
      notifyTiers: ["B", "bogus", "A"] as unknown as Settings["notifyTiers"],
    });
    expect(s).toMatchObject({
      userTimeZone: "Asia/Kolkata", quietHours: { start: "22:00", end: "07:00" }, eveningFallback: "21:30",
      followUpDays: DEFAULT_SETTINGS.followUpDays, maxYears: 3, notifyTiers: ["A", "B"], peakWindow: DEFAULT_SETTINGS.peakWindow,
    });
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ notifyTiers: [] }).notifyTiers).toEqual([]); // "no alerts" is a valid choice
    expect(sanitizeSettings({ notifyTiers: "A" as unknown as Settings["notifyTiers"] }).notifyTiers).toEqual(DEFAULT_SETTINGS.notifyTiers);
  });
});

describe("scan pipeline", () => {
  it("first scan seeds silently, the next scan alerts only on new jobs", async () => {
    const t = setup();
    t.src.set([job("1"), job("2", "Senior Backend Engineer")]);
    const first = await t.run();
    expect(first.companies[0]!.baseline).toBe(true);
    expect(t.store.jobs).toHaveLength(1); // senior role filtered out
    expect(t.store.jobs[0]!.baseline).toBe(true);
    expect(t.notifier.sent).toHaveLength(0);

    t.src.set([job("1"), job("2", "Senior Backend Engineer"), job("3", "Software Engineer - New Grad")]);
    const second = await t.run();
    expect(second.notifications.found).toBe(1);
    expect(t.notifier.sent[0]!.title).toMatch(/New Tier A: Acme/);
    expect(t.notifier.sent[0]!.requireInteraction).toBe(true); // priority company
  });

  it("is idempotent: re-running with no changes sends nothing new", async () => {
    const t = setup();
    t.src.set([]);
    await t.run();
    t.src.set([job("9")]);
    await t.run();
    const before = t.notifier.sent.length;
    await t.run();
    expect(t.notifier.sent.length).toBe(before);
  });

  it("sends the peak reminder once the window arrives, unless applied or not interested", async () => {
    const t = setup();
    t.src.set([]);
    await t.run();
    t.src.set([job("5"), job("6", "Software Engineer - New Grad"), job("7", "SDE-1")]);
    await t.run(); // found at Thu 14:00 IST -> peak Fri 08:00 IST
    const [a, b] = t.store.jobs;
    a!.status = "applied";
    a!.appliedAt = "2026-11-26T09:00:00Z";
    b!.status = "not_interested";

    t.setNow(new Date("2026-11-27T02:45:00Z")); // Fri 08:15 IST
    const r = await t.run();
    expect(r.notifications.peak).toBe(1);
    expect(t.notifier.sent.at(-1)!.title).toMatch(/Apply now/);
  });

  it("follow-up reminder fires after followUpDays for applied jobs", async () => {
    const t = setup();
    t.src.set([]);
    await t.run();
    t.src.set([job("8")]);
    await t.run();
    const j = t.store.jobs[0]!;
    j.status = "applied";
    j.appliedAt = "2026-11-26T09:00:00Z";
    t.setNow(new Date("2026-12-03T09:00:00Z"));
    const r = await t.run();
    expect(r.notifications.followUp).toBe(1);
  });

  it("marks jobs closed when they vanish from a complete listing", async () => {
    const t = setup(true);
    t.src.set([job("1")]);
    await t.run();
    t.src.set([]);
    const r = await t.run();
    expect(r.companies[0]!.closed).toBe(1);
    expect(t.store.jobs[0]!.closed).toBe(true);
  });

  it("flags reposts (same title + location, new id) and does not alert", async () => {
    const t = setup();
    t.src.set([job("1")]);
    await t.run();
    t.src.set([job("1"), job("1-repost")]);
    const r = await t.run();
    expect(r.notifications.found).toBe(0);
    expect(t.store.jobs.find((x) => x.externalId === "1-repost")!.reposted).toBe(true);
  });

  it("drops remote roles that require work authorization elsewhere", async () => {
    const t = setup();
    t.src.set([]);
    await t.run();
    t.src.set([{ ...job("r1", "Backend Engineer I", ["Remote"]), description: "1 year of experience. Must be authorized to work in the United States." }]);
    await t.run();
    expect(t.store.jobs).toHaveLength(0);
  });

  it("skips the follow-up once a reply (stage) is recorded", async () => {
    const t = setup();
    t.src.set([]);
    await t.run();
    t.src.set([job("8")]);
    await t.run();
    const j = t.store.jobs[0]!;
    j.status = "applied";
    j.appliedAt = "2026-11-26T09:00:00Z";
    j.stage = "interview";
    t.setNow(new Date("2026-12-03T09:00:00Z"));
    expect((await t.run()).notifications.followUp).toBe(0);
  });

  it("alerts only for the chosen tiers, and never later for the others", async () => {
    const store = new MemoryStore();
    const notifier = new ConsoleNotifier();
    const src = fake();
    let settings = { ...DEFAULT_SETTINGS, notifyTiers: ["A"] as Settings["notifyTiers"] };
    let now = new Date("2026-11-26T08:30:00Z");
    const run = () => scanAll([company], { store, notifier, profile: DEFAULT_PROFILE, settings, now: () => now, adapterFor: () => src.adapter });
    src.set([]);
    await run();
    // "Software Engineer" with no description is a Maybe; the new-grad role is Tier A.
    src.set([{ ...job("m1", "Software Engineer"), description: undefined }, job("a1", "Software Engineer - New Grad")]);
    const r = await run();
    expect(store.jobs.map((j) => j.tier).sort()).toEqual(["A", "Maybe"]);
    expect(r.notifications.found).toBe(1);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.title).toMatch(/New Tier A/);

    // Turning Maybe alerts on afterwards must not replay the old match.
    settings = { ...DEFAULT_SETTINGS };
    now = new Date("2026-11-26T08:45:00Z");
    expect((await run()).notifications.found).toBe(0);
  });

  it("keeps scanning and alerting when settings or a company hold an invalid time zone", async () => {
    const store = new MemoryStore();
    const notifier = new ConsoleNotifier();
    const src = fake();
    const bad = { ...DEFAULT_SETTINGS, userTimeZone: "Asia/Kolkatta", quietHours: { start: "25:00", end: "x" } };
    const run = () =>
      scanAll([{ ...company, hqTimeZone: "Nowhere/City" }], { store, notifier, profile: DEFAULT_PROFILE, settings: bad, now: () => new Date("2026-11-26T08:30:00Z"), adapterFor: () => src.adapter });
    src.set([]);
    await run();
    src.set([job("1"), job("2", "Backend Engineer I", ["Remote"])]);
    const r = await run();
    expect(r.companies[0]).toMatchObject({ ok: true, matched: 2 });
    expect(r.notifications.found).toBe(2);
  });

  it("records a failure without throwing and keeps other state", async () => {
    const store = new MemoryStore();
    const broken: Adapter = { complete: false, list: async () => { throw new Error("boom"); } };
    const r = await scanAll([company], { store, notifier: new ConsoleNotifier(), profile: DEFAULT_PROFILE, settings: DEFAULT_SETTINGS, adapterFor: () => broken });
    expect(r.companies[0]).toMatchObject({ ok: false, error: "boom" });
    expect((await store.getHealth("acme"))!.consecutiveFailures).toBe(1);
  });
});
