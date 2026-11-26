# Job sources

Verified by probing on 2026-11-26 (one request per endpoint, generic User-Agent).
Undocumented endpoints can change without notice; the weekly health check
(milestone 7) flags a source when its response format breaks.

| Company | Adapter | Endpoint | Notes |
|---|---|---|---|
| Amazon | `amazon` | `amazon.jobs/en/search.json?country=IND&category[]=software-development&sort=recent` | Newest first; stops at first seen job |
| Microsoft | `microsoft` | `apply.careers.microsoft.com/api/pcsx/search` (Eightfold) | Needs `Referer`; 10 per page; returns 429 on bursts |
| Google | `google` | Results page, embedded `AF_initDataCallback ds:1` JSON | No public API; positional fields (see adapter) |
| Apple | `apple` | Search page, embedded `__staticRouterHydrationData` JSON | Country-only "India" locations are common |
| Atlassian | `atlassian` | `atlassian.com/endpoint/careers/listings` | Full list; only an "updated" date, no posted date |
| Oracle | `oracle` | Oracle Cloud HCM `recruitingCEJobRequisitions` (site `CX_45001`) | Short description only |
| Salesforce, Adobe, Nvidia, PayPal, Cisco | `workday` | `{tenant}.wdN.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | Throttles by client IP (429 on every tenant after a burst). Shared 5 s queue, no 429 retries |
| Stripe, Databricks, GitLab, Coinbase, Cloudflare, Rubrik, Twilio, Groww, Razorpay | `greenhouse` | `boards-api.greenhouse.io/v1/boards/{board}/jobs` | Full list; Razorpay's board is `razorpaysoftwareprivatelimited` |
| CRED, Meesho | `lever` | `api.lever.co/v0/postings/{site}?mode=json` | Full list with descriptions |

## Not yet supported

| Company | Status |
|---|---|
| Walmart Global Tech | Workday site name unknown (guess returned 422); careers.walmart.com loads jobs client-side |
| Goldman Sachs | higher.gs.com loads jobs client-side |
| PhonePe | Careers page loads jobs client-side |
| Flipkart | TurboHire career page; API not identified |
| Intuit | Radancy (TalentBrew) HTML results endpoint; parser not written |
| Uber | Cloudflare bot challenge. We do not bypass bot protection, so Uber needs replacing |

## Rules for adding a source

- Public endpoints that the company's own careers site uses; check robots.txt and terms first.
- No login, no CAPTCHA or bot-challenge bypass, no LinkedIn scraping.
- Newest-first paging that stops at already-seen jobs; detail calls only for title-matched jobs.
