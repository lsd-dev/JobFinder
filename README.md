# JobFinder

Personal job-alert dashboard. Every 15 minutes a GitHub Actions job scans the
career sites of a watchlist of companies, keeps the software-development roles
that fit an early-career backend engineer (target Indian cities or global
remote), and sends browser push notifications:

- **Found**: right after a match is detected (apply within 24 hours).
- **Apply now**: at the start of the recruiter's 08:00-10:00 weekday window in
  *their* time zone (moved to 22:45 IST the evening before if that falls in
  your 23:00-07:00 quiet hours).
- **Follow up**: a few days after you mark a job Applied, unless you have
  recorded a reply (Interview, Offer or Rejected).

In Settings you choose which tiers (A, B, Maybe) send alerts; the rest still
show on the dashboard. Jobs posted in the last 24 hours carry a **Fresh** badge,
and the Applied list shows counts by stage and a reply rate.

Everything runs on free tiers: GitHub Actions (public repo), Firestore and
Firebase Hosting (Spark plan), and Firebase Cloud Messaging.

## Status

| Milestone | State |
|---|---|
| 1. Scaffold + endpoint probe | Done ([docs/sources.md](docs/sources.md)) |
| 2. Source adapters | Done for 27 of 30 companies; 3 not supported ([why](docs/sources.md)) |
| 3. Matcher (role, level, location, work authorization) | Done, unit-tested |
| 4. Firestore store | Running against real Firestore; rules deployed |
| 5. Dashboard (React + Firebase Hosting, no sign-in) | Deployed to Firebase Hosting |
| 6. Push notifications (FCM) | Scanner sender, service worker and dashboard opt-in written; Web Push key set. Not yet confirmed end to end on a device |
| 7. GitHub Actions workflows + health check | Scan workflow running on GitHub. Three Workday sites (Salesforce, Adobe, Cisco) return HTTP 429 to GitHub's servers. Health-check and keepalive workflows not yet observed running |

## Going live

After changing `firestore.rules` or anything under `dashboard/`, publish again
with `npm run build` and `npx firebase-tools deploy --only firestore:rules,hosting`.
The scanner needs no deploy: GitHub runs whatever is on `main`.

1. **Rules**: publish `firestore.rules` (Firebase console > Firestore > Rules,
   or `npx firebase-tools deploy --only firestore:rules`).
2. **Web Push key**: Firebase console > Project settings > Cloud Messaging >
   Web Push certificates > Generate key pair. Paste the key into `vapidKey` in
   `dashboard/src/firebaseConfig.ts` (a public identifier, safe to commit).
3. **Dashboard**: `npm run build`, then `npx firebase-tools deploy --only hosting`.
   Open the site, choose **Create a new key** and keep the key somewhere safe.
4. **GitHub secrets** (repository > Settings > Secrets and variables > Actions):
   - `SPACE_KEY`: the key from step 3.
   - `FIREBASE_SERVICE_ACCOUNT`: the full JSON of a service-account key
     (Firebase console > Project settings > Service accounts > Generate new
     private key). Never commit this file.
   - Optional repository *variable* `DASHBOARD_URL` if the dashboard is not at
     `https://<project-id>.web.app`.
5. **Notifications**: in the dashboard, Settings > Notifications on this
   device > Turn on. Repeat on each browser or phone. On iPhone and iPad, add
   the dashboard to the Home Screen first.

## Workflows

| Workflow | When | What |
|---|---|---|
| `scan.yml` | Every 15 minutes (GitHub may start runs late) | Scans the watchlist, stores matches, sends pushes. Logs counts only |
| `health-check.yml` | Mondays | Fails and sends a push if sites have failed for about a day, or scans have stopped |
| `keepalive.yml` | 1st and 15th | Re-enables the scheduled workflows so GitHub does not disable them after 60 days without commits |
| `ci.yml` | Push and pull request | Type-check, tests, dashboard build. Uses no secrets |

## Local development

Requires Node 22 or newer (the workflows use the version in `.nvmrc`).

```sh
npm install
npm test                                   # unit tests
npm run scan -- --dry-run --list           # live scan, local JSON state, prints "pushes"
npm run scan -- --dry-run --only amazon    # one company
npm run scan -- --dry-run --reset          # forget local state (next run seeds silently)
npm run dev                                # dashboard at http://localhost:5173 (add ?demo for sample data)
npm run build                              # dashboard production build -> dashboard/dist
```

A production scan (`npm run scan` without `--dry-run`) needs `SPACE_KEY` and
Firebase credentials; see [.env.example](.env.example).

Dry runs keep state in `.local-state/state.json` (git-ignored). The first scan
of a company seeds its existing jobs without notifications.

## Layout

```
scanner/src/
  adapters/   one file per career-site type (greenhouse, lever, workday, amazon, ...)
  match/      classify (role + level), location, keywords, work-auth / pay / visa extras
  schedule/   peak-time reminder computation (time-zone aware, no dependencies)
  store/      persistence interface, in-memory store, Firestore store
  notify/     notification message builders, console notifier, FCM sender
  health.ts   weekly health summary (healthcheck.ts is its entry point)
  scan.ts     pipeline: list -> title gate -> enrich -> classify -> store -> notify
  cli.ts      entry point
scanner/test/ unit tests (matcher, peak time, parsers, pipeline, Firestore store)
dashboard/    React + Vite dashboard: jobs, watchlist, health, settings
firestore.rules, firebase.json   security rules and hosting config
docs/         source notes
```

## Access and privacy

There is no sign-in. All Firestore data lives under `/spaces/{key}`, where the
key is a long random string (32+ characters) that is never committed. The
dashboard receives it from the link you open once per browser; the scanner
reads it from a GitHub Actions secret. [firestore.rules](firestore.rules)
denies everything outside that path and stops clients from listing keys.
Treat the link like a password: anyone who has it can read and edit your data.

This repository is public. It holds no personal data and no secrets: the
resume-derived profile, settings and job data live in Firestore, and
credentials live in GitHub Actions secrets. Workflow logs print counts only.
The Firebase web config in `dashboard/src/firebaseConfig.ts` is a public
project identifier, not a credential.

Deploy the rules by pasting `firestore.rules` into Firebase console >
Firestore > Rules, or with `npx firebase-tools deploy --only firestore:rules`.
