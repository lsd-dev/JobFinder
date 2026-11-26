/**
 * Weekly health check (see .github/workflows/health-check.yml).
 *
 *   npm run health
 *
 * Reads the watchlist and the per-company scan health from Firestore, sends
 * one push if sources have been failing for about a day or the scans have
 * stopped, and exits non-zero in those cases so GitHub also emails the
 * repository owner. Read-only apart from the push. Prints counts only.
 */
import { WATCHLIST } from "./config/watchlist.js";
import { connectFirebase } from "./firebase.js";
import { healthMessage, summarizeHealth } from "./health.js";
import { FcmNotifier } from "./notify/fcm.js";
import { FirestoreStore } from "./store/firestore.js";

async function main(): Promise<number> {
  const spaceKey = process.env.SPACE_KEY;
  if (!spaceKey) {
    console.error("SPACE_KEY is not set.");
    return 2;
  }
  const { db, messaging } = connectFirebase();
  const store = new FirestoreStore(db, spaceKey);
  const [companies, health] = await Promise.all([store.loadWatchlist(WATCHLIST), store.loadHealth()]);
  const summary = summarizeHealth(companies, health, new Date());
  console.log(`Health: scanned=${summary.scanned} failing=${summary.failing} neverScanned=${summary.neverScanned} stale=${summary.stale}`);

  const msg = healthMessage(summary);
  if (!msg) return 0;
  const dashboardUrl = process.env.DASHBOARD_URL || `https://${process.env.FIREBASE_PROJECT_ID || "jobfinder-9a0fc"}.web.app`;
  try {
    await new FcmNotifier(messaging, store.devices, dashboardUrl, (m) => console.log(m)).send(msg);
  } catch (e) {
    console.error(`push failed: ${e instanceof Error ? e.name : "error"}`);
  }
  return 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : "health check failed");
    process.exit(1);
  },
);
