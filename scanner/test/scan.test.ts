import { describe, expect, it } from "vitest";
import type { Adapter, Company, RawJob } from "../src/types.js";
import { scanAll } from "../src/scan.js";
import { MemoryStore } from "../src/store/memory.js";
import { ConsoleNotifier } from "../src/notify/messages.js";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from "../src/config/profile.js";

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

  it("records a failure without throwing and keeps other state", async () => {
    const store = new MemoryStore();
    const broken: Adapter = { complete: false, list: async () => { throw new Error("boom"); } };
    const r = await scanAll([company], { store, notifier: new ConsoleNotifier(), profile: DEFAULT_PROFILE, settings: DEFAULT_SETTINGS, adapterFor: () => broken });
    expect(r.companies[0]).toMatchObject({ ok: false, error: "boom" });
    expect((await store.getHealth("acme"))!.consecutiveFailures).toBe(1);
  });
});
