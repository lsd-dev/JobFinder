# JobFinder

Personal job-alert dashboard. Every 15 minutes a GitHub Actions job scans the
career sites of a watchlist of companies, keeps the software-development roles
that fit an early-career backend engineer (target Indian cities or global
remote), and sends browser push notifications:

- **Found**: right after a match is detected (apply within 24 hours).
- **Apply now**: at the start of the recruiter's 08:00-10:00 weekday window in
  *their* time zone (moved to 22:45 IST the evening before if that falls in
  your 23:00-07:00 quiet hours).
- **Follow up**: a few days after you mark a job Applied.

Everything runs on free tiers: GitHub Actions (public repo), Firestore and
Firebase Hosting (Spark plan), and Firebase Cloud Messaging.

## Status

| Milestone | State |
|---|---|
| 1. Scaffold + endpoint probe | Done ([docs/sources.md](docs/sources.md)) |
| 2. Source adapters | Done for 22 companies; 5 pending, Uber to replace |
| 3. Matcher (role, level, location, work authorization) | Done, unit-tested |
| 4. Firestore store | Next |
| 5. Dashboard (React + Firebase Hosting) | Not started |
| 6. Push notifications (FCM) | Not started |
| 7. GitHub Actions workflows + health check | Not started |

## Local development

Requires Node 22+.

```sh
npm install
npm test                                   # unit tests
npm run scan -- --dry-run --list           # live scan, local JSON state, prints "pushes"
npm run scan -- --dry-run --only amazon    # one company
npm run scan -- --dry-run --reset          # forget local state (next run seeds silently)
```

Dry runs keep state in `.local-state/state.json` (git-ignored). The first scan
of a company seeds its existing jobs without notifications.

## Layout

```
scanner/src/
  adapters/   one file per career-site type (greenhouse, lever, workday, amazon, ...)
  match/      classify (role + level), location, keywords, work-auth / pay / visa extras
  schedule/   peak-time reminder computation (time-zone aware, no dependencies)
  store/      persistence interface + in-memory store (Firestore next)
  notify/     notification message builders + console notifier
  scan.ts     pipeline: list -> title gate -> enrich -> classify -> store -> notify
  cli.ts      entry point
scanner/test/ unit tests (matcher, peak time, parsers, pipeline)
docs/         source notes
```

## Privacy

This repository is public. It holds no personal data and no secrets: the
resume-derived profile, settings and job data live in Firestore, and
credentials live in GitHub Actions secrets. Workflow logs print counts only.
