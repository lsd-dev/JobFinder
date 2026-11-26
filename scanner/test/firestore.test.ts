import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import type { Adapter, Company, RawJob } from "../src/types.js";
import { scanAll } from "../src/scan.js";
import { FirestoreStore } from "../src/store/firestore.js";
import { FcmNotifier } from "../src/notify/fcm.js";
import { ConsoleNotifier } from "../src/notify/messages.js";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from "../src/config/profile.js";
import { FakeFirestore } from "./helpers/fakeFirestore.js";

// Logic tests against an in-memory fake. Real Firestore behaviour (index
// merging for the multi-equality queries, quotas) is not covered here.

const KEY = "k".repeat(32);
const company: Company = { id: "acme", name: "Acme", enabled: true, hqTimeZone: "America/Los_Angeles", source: { kind: "amazon" } };
const job = (id: string, title = "Backend Engineer I"): RawJob => ({
  externalId: id, title, locations: ["Bengaluru, India"], url: `https://acme/jobs/${id}`, description: "1+ years of experience with Node.js, TypeScript and SQL.",
});

function setup(complete = true) {
  const db = new FakeFirestore();
  const store = new FirestoreStore(db as unknown as Firestore, KEY);
  const notifier = new ConsoleNotifier();
  let jobs: RawJob[] = [];
  const adapter: Adapter = { complete, list: async () => jobs };
  let now = new Date("2026-11-26T08:30:00Z"); // Thu 14:00 IST
  // A fresh store per run, like a new GitHub Actions process.
  const run = () =>
    scanAll([company], {
      store: new FirestoreStore(db as unknown as Firestore, KEY), notifier, profile: DEFAULT_PROFILE, settings: DEFAULT_SETTINGS, now: () => now, adapterFor: () => adapter,
    });
  const jobDoc = (id: string) => db.docs.get(`spaces/${KEY}/jobs/acme_${id}`);
  return { db, store, notifier, run, jobDoc, set: (j: RawJob[]) => (jobs = j), setNow: (d: Date) => (now = d) };
}

describe("FirestoreStore", () => {
  it("rejects short or malformed space keys", () => {
    const db = new FakeFirestore() as unknown as Firestore;
    expect(() => new FirestoreStore(db, "short")).toThrow(/32/);
    expect(() => new FirestoreStore(db, "a/".repeat(20))).toThrow(/\//);
  });

  it("baseline is silent; later runs alert once and never duplicate", async () => {
    const t = setup();
    t.set([job("1")]);
    await t.run();
    expect(t.jobDoc("1")).toMatchObject({ baseline: true, foundNotifiedAt: null, peakRemindedAt: null, followUpRemindedAt: null });
    expect(t.notifier.sent).toHaveLength(0);

    // A different title: the same title + city within 30 days would count as a repost.
    t.set([job("1"), job("2", "Software Engineer - New Grad")]);
    const second = await t.run();
    expect(second.notifications.found).toBe(1);
    expect(typeof t.jobDoc("2")!.foundNotifiedAt).toBe("string");

    const third = await t.run();
    expect(third.companies[0]!.matched).toBe(0);
    expect(third.notifications.found).toBe(0);
    expect(t.notifier.sent).toHaveLength(1);
  });

  it("stores no undefined values and keeps everything under the space key", async () => {
    const t = setup();
    t.set([job("1")]);
    await t.run(); // the fake throws on undefined
    expect([...t.db.docs.keys()].every((p) => p.startsWith(`spaces/${KEY}/`))).toBe(true);
    expect(t.db.docs.has(`spaces/${KEY}/health/acme`)).toBe(true);
    expect(t.db.docs.get(`spaces/${KEY}/state/acme`)).toMatchObject({ initialized: true, seen: ["1"], openMatched: ["1"] });
  });

  it("marks a job closed when it leaves a complete listing, across separate runs", async () => {
    const t = setup();
    t.set([job("1"), job("2", "Software Engineer - New Grad")]);
    await t.run();
    t.set([job("2", "Software Engineer - New Grad")]);
    const r = await t.run();
    expect(r.companies[0]!.closed).toBe(1);
    expect(t.jobDoc("1")).toMatchObject({ closed: true });
    expect(t.jobDoc("2")).toMatchObject({ closed: false });
    expect(t.db.docs.get(`spaces/${KEY}/state/acme`)!.openMatched).toEqual(["2"]);
  });

  it("an unchanged run writes only the health document", async () => {
    const t = setup();
    t.set([job("1")]);
    await t.run();
    await t.run(); // purge marker for the day is written by now
    const before = t.db.writes;
    await t.run();
    expect(t.db.writes - before).toBe(1);
  });

  it("peak reminder respects status edits made from the dashboard", async () => {
    const t = setup();
    t.set([]);
    await t.run();
    t.set([job("1"), job("2"), job("3")]);
    await t.run();
    await t.db.collection(`spaces/${KEY}/jobs`).doc("acme_2").update({ status: "applied", appliedAt: "2026-11-26T09:00:00.000Z" });
    await t.db.collection(`spaces/${KEY}/jobs`).doc("acme_3").update({ status: "not_interested" });
    t.setNow(new Date("2026-11-27T02:45:00Z")); // Fri 08:15 IST
    const r = await t.run();
    expect(r.notifications.peak).toBe(1);
    expect(typeof t.jobDoc("1")!.peakRemindedAt).toBe("string");
    expect(t.jobDoc("2")!.peakRemindedAt).toBeNull();

    t.setNow(new Date("2026-12-03T09:30:00Z")); // 7 days after applying
    const later = await t.run();
    expect(later.notifications.followUp).toBe(1);
    expect((await t.run()).notifications.followUp).toBe(0);
  });

  it("purges old unapplied jobs once per day and keeps applied ones", async () => {
    const t = setup(false);
    const jobs = t.db.collection(`spaces/${KEY}/jobs`);
    const old = { companyId: "acme", externalId: "x", firstSeenAt: "2026-01-01T00:00:00.000Z", status: "not_applied" };
    await jobs.doc("acme_old").set(old);
    await jobs.doc("acme_applied").set({ ...old, status: "applied" });
    expect(await t.store.purgeOld("2026-06-01T00:00:00.000Z")).toBe(1);
    expect(t.jobDoc("old")).toBeUndefined();
    expect(t.jobDoc("applied")).toBeDefined();
    await jobs.doc("acme_old2").set(old);
    expect(await t.store.purgeOld("2026-06-01T00:00:00.000Z")).toBe(0); // already ran today
  });

  it("seeds the watchlist once and merges config over defaults", async () => {
    const t = setup();
    expect(await t.store.loadWatchlist([company])).toEqual([company]);
    await t.db.collection(`spaces/${KEY}/companies`).doc("acme").update({ enabled: false });
    expect((await t.store.loadWatchlist([company]))[0]!.enabled).toBe(false);

    await t.db.collection(`spaces/${KEY}/config`).doc("settings").set({ maxYears: 3 });
    const cfg = await t.store.loadConfig({ profile: DEFAULT_PROFILE, settings: DEFAULT_SETTINGS });
    expect(cfg.settings.maxYears).toBe(3);
    expect(cfg.settings.userTimeZone).toBe("Asia/Kolkata");
    expect(cfg.profile.skills).toEqual(DEFAULT_PROFILE.skills);
  });
});

describe("health for the weekly check", () => {
  it("loads what the scan wrote", async () => {
    const t = setup();
    t.set([job("1")]);
    await t.run();
    expect(await t.store.loadHealth()).toMatchObject({ acme: { ok: true, consecutiveFailures: 0, fetched: 1 } });
  });
});

describe("FcmNotifier", () => {
  const msg = { title: "t", body: "b", link: "/?job=1", tag: "found", requireInteraction: false };

  it("does nothing without devices, and removes dead tokens", async () => {
    const t = setup();
    const calls: { tokens: string[]; data?: Record<string, string>; webpush?: { fcmOptions?: { link?: string } } }[] = [];
    const messaging = {
      sendEachForMulticast: async (m: { tokens: string[] }) => {
        calls.push(m);
        return {
          successCount: 1, failureCount: 1,
          responses: m.tokens.map((tok) => (tok === "dead" ? { success: false, error: { code: "messaging/registration-token-not-registered" } } : { success: true })),
        };
      },
    } as unknown as Pick<Messaging, "sendEachForMulticast">;
    const n = new FcmNotifier(messaging, t.store.devices, "https://example.web.app/");

    await n.send(msg);
    expect(calls).toHaveLength(0);

    const devices = t.db.collection(`spaces/${KEY}/devices`);
    await devices.doc("live").set({ token: "live" });
    await devices.doc("dead").set({ token: "dead" });
    await n.send(msg);
    expect(calls[0]!.tokens.sort()).toEqual(["dead", "live"]);
    expect(calls[0]!.webpush!.fcmOptions!.link).toBe("https://example.web.app/?job=1");
    expect(calls[0]!.data).toEqual({ title: "t", body: "b", tag: "found", link: "/?job=1", requireInteraction: "0" });
    expect(t.db.docs.has(`spaces/${KEY}/devices/dead`)).toBe(false);
    expect(t.db.docs.has(`spaces/${KEY}/devices/live`)).toBe(true);
  });
});
