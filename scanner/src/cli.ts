/**
 * Scanner entry point.
 *
 *   npm run scan                              # production: Firestore + web push
 *   npm run scan -- --dry-run                 # local JSON state + console "pushes"
 *   npm run scan -- --dry-run --only amazon   # one company
 *   npm run scan -- --dry-run --reset         # forget local state (next run seeds again)
 *
 * Production needs SPACE_KEY (32+ characters) and Firebase credentials; see
 * .env.example. The watchlist, profile and settings are then read from
 * Firestore (the watchlist is seeded from config/watchlist.ts on first run).
 */
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { WATCHLIST } from "./config/watchlist.js";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./config/profile.js";
import { MemoryStore } from "./store/memory.js";
import { ConsoleNotifier } from "./notify/messages.js";
import { scanAll } from "./scan.js";
import type { Store } from "./store/types.js";
import type { Notifier } from "./notify/messages.js";
import type { Company } from "./types.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(): Promise<number> {
  const dryRun = flag("dry-run");
  const only = value("only");
  const log = (m: string) => console.log(m);

  let store: Store;
  let notifier: Notifier;
  let watchlist: Company[] = WATCHLIST;
  let profile = DEFAULT_PROFILE;
  let settings = DEFAULT_SETTINGS;
  let memory: MemoryStore | undefined;

  if (dryRun) {
    const stateFile = resolve(process.cwd(), "..", ".local-state", "state.json");
    if (flag("reset")) await rm(stateFile, { force: true });
    memory = await new MemoryStore(stateFile).load();
    store = memory;
    notifier = new ConsoleNotifier();
  } else {
    if (flag("reset") || flag("list")) {
      console.error("--reset and --list are only available with --dry-run.");
      return 2;
    }
    const spaceKey = process.env.SPACE_KEY;
    if (!spaceKey) {
      console.error("SPACE_KEY is not set. Use --dry-run for a local scan.");
      return 2;
    }
    // Loaded lazily so dry runs and unit tests never need the Admin SDK.
    const [{ connectFirebase }, { FirestoreStore }, { FcmNotifier }] = await Promise.all([
      import("./firebase.js"),
      import("./store/firestore.js"),
      import("./notify/fcm.js"),
    ]);
    const { db, messaging } = connectFirebase();
    const fs = new FirestoreStore(db, spaceKey);
    watchlist = await fs.loadWatchlist(WATCHLIST);
    ({ profile, settings } = await fs.loadConfig({ profile: DEFAULT_PROFILE, settings: DEFAULT_SETTINGS }));
    store = fs;
    const dashboardUrl = process.env.DASHBOARD_URL || `https://${process.env.FIREBASE_PROJECT_ID || "jobfinder-9a0fc"}.web.app`;
    notifier = new FcmNotifier(messaging, fs.devices, dashboardUrl, log);
  }

  const companies = only ? watchlist.filter((c) => c.id === only) : watchlist;
  if (only && companies.length === 0) {
    console.error(`Unknown company id "${only}". Known: ${watchlist.map((c) => c.id).join(", ")}`);
    return 2;
  }

  const t0 = Date.now();
  const report = await scanAll(companies, { store, notifier, profile, settings, log });
  await memory?.flush();

  const failed = report.companies.filter((c) => !c.ok);
  console.log(
    `\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${report.companies.length} companies, ` +
      `${report.companies.reduce((n, c) => n + c.matched, 0)} new matches, ${failed.length} failed. ` +
      `Pushes: found=${report.notifications.found} peak=${report.notifications.peak} followUp=${report.notifications.followUp}.`,
  );
  if (flag("list") && memory) {
    for (const j of memory.jobs.sort((a, b) => a.tier.localeCompare(b.tier) || b.score - a.score)) {
      console.log(`  [${j.tier}] ${j.companyName.padEnd(11)} ${j.title.slice(0, 60).padEnd(60)} ${j.location.slice(0, 28).padEnd(28)} ${j.reasons.join("; ").slice(0, 70)}`);
    }
  }
  // Exit non-zero only if every source failed (one flaky site should not fail the workflow).
  return failed.length && failed.length === report.companies.filter((c) => c.error !== "source not supported yet").length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
