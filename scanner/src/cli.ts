/**
 * Scanner entry point.
 *
 *   npm run scan -- --dry-run                 # local JSON state + console "pushes"
 *   npm run scan -- --dry-run --only amazon   # one company
 *   npm run scan -- --dry-run --reset         # forget local state (next run seeds again)
 *
 * Production mode (Firestore + FCM) is added in the next milestone; until then
 * the CLI refuses to run without --dry-run so nothing is half-wired.
 */
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { WATCHLIST } from "./config/watchlist.js";
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./config/profile.js";
import { MemoryStore } from "./store/memory.js";
import { ConsoleNotifier } from "./notify/messages.js";
import { scanAll } from "./scan.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(): Promise<number> {
  if (!flag("dry-run")) {
    console.error("Only --dry-run is available until the Firestore store is added.");
    return 2;
  }
  const stateFile = resolve(process.cwd(), "..", ".local-state", "state.json");
  if (flag("reset")) await rm(stateFile, { force: true });

  const only = value("only");
  const companies = only ? WATCHLIST.filter((c) => c.id === only) : WATCHLIST;
  if (only && companies.length === 0) {
    console.error(`Unknown company id "${only}". Known: ${WATCHLIST.map((c) => c.id).join(", ")}`);
    return 2;
  }

  const store = await new MemoryStore(stateFile).load();
  const notifier = new ConsoleNotifier();
  const t0 = Date.now();
  const report = await scanAll(companies, { store, notifier, profile: DEFAULT_PROFILE, settings: DEFAULT_SETTINGS, log: (m) => console.log(m) });
  await store.flush();

  const failed = report.companies.filter((c) => !c.ok);
  console.log(
    `\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${report.companies.length} companies, ` +
      `${report.companies.reduce((n, c) => n + c.matched, 0)} new matches, ${failed.length} failed. ` +
      `Pushes: found=${report.notifications.found} peak=${report.notifications.peak} followUp=${report.notifications.followUp}.`,
  );
  if (flag("list")) {
    for (const j of store.jobs.sort((a, b) => a.tier.localeCompare(b.tier) || b.score - a.score)) {
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
