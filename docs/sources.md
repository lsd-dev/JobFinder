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
| Salesforce, Adobe, Cisco | `workday` | `{tenant}.wdN.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | Works from a home or office network, but the first GitHub Actions run (2026-11-26) got HTTP 429 on the first request to every tenant: Workday is behind Cloudflare, which limits GitHub's shared server addresses. Not worked around. No alternative source found yet |
| Nvidia, PayPal | `eightfold` | `{company}.eightfold.ai/api/pcsx/search` and `/api/pcsx/position_details` | Moved off Workday for the reason above. robots.txt allows `/api/pcsx`. Newest first, 10 per page; detail call gives the description and the company's public link |
| Stripe, Databricks, GitLab, Coinbase, Cloudflare, Rubrik, Twilio, MongoDB, Okta, Zscaler, Groww, Razorpay | `greenhouse` | `boards-api.greenhouse.io/v1/boards/{board}/jobs` | Full list; Razorpay's board is `razorpaysoftwareprivatelimited` |
| CRED, Meesho | `lever` | `api.lever.co/v0/postings/{site}?mode=json` | Full list with descriptions |
| PhonePe | `smartrecruiters` | `api.smartrecruiters.com/v1/companies/PHONEPELIMITED/postings` | Documented public Posting API; newest first, 100 per page; full list (163 jobs on 2026-11-26). Detail call for the description |
| Intuit | `radancy` | `jobs.intuit.com/sitemap.xml`, then the job page's schema.org `JobPosting` block | robots.txt disallows `/search-jobs/`, so the search endpoint is not used. The sitemap gives id, title slug and city; the page gives the real title, country, date and description |

## Not supported

Checked again on 2026-11-26. Each of these would need something the rules below exclude.

| Company | Status |
|---|---|
| Walmart Global Tech | No public Workday job site was found (`walmart.wd5.myworkdayjobs.com` returns 406/422). careers.walmart.com robots.txt disallows `/api` and `/results`; its sitemap lists about 15,600 job ids without titles or locations, so finding India roles would mean fetching every job page |
| Goldman Sachs | higher.gs.com robots.txt allows only single role pages (`/roles/`) and disallows everything else. The list comes from a GraphQL API on `api-higher.gs.com`, which is undocumented and has no robots.txt. Not used without a decision that this is acceptable |
| Flipkart | The job list on flipkartcareers.com is a static page (ten truncated titles, no links). The real list is on TurboHire, whose API needs a session token issued to the page, and showed about 15 roles (1 in Technology) |
| Uber | Dropped from the watchlist: Cloudflare bot challenge, which we do not bypass |

## Rules for adding a source

- Public endpoints that the company's own careers site uses; check robots.txt and terms first.
- No login, no CAPTCHA or bot-challenge bypass, no LinkedIn scraping.
- Newest-first paging that stops at already-seen jobs; detail calls only for title-matched jobs.
