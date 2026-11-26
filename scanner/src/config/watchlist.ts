import type { Company } from "../types.js";

/**
 * Seed watchlist. Once Firestore is wired up, the dashboard's watchlist editor
 * becomes the source of truth and this file only seeds an empty database.
 * Endpoints were verified by a probe on 2026-11-26; see docs/sources.md.
 */
const LA = "America/Los_Angeles";
const IST = "Asia/Kolkata";

export const WATCHLIST: Company[] = [
  // --- Must-haves (custom career sites) ---
  { id: "amazon", name: "Amazon", enabled: true, priority: true, hqTimeZone: LA, source: { kind: "amazon" } },
  { id: "microsoft", name: "Microsoft", enabled: true, priority: true, hqTimeZone: LA, source: { kind: "microsoft" } },
  {
    id: "google", name: "Google", enabled: true, priority: true, hqTimeZone: LA,
    // Google: SWE II is entry level and SWE III asks for ~1-2 years.
    levelOverrides: { II: "entry", III: "ok" },
    source: { kind: "google" },
  },
  { id: "apple", name: "Apple", enabled: true, priority: true, hqTimeZone: LA, source: { kind: "apple" } },
  { id: "atlassian", name: "Atlassian", enabled: true, priority: true, hqTimeZone: "Australia/Sydney", source: { kind: "atlassian" } },

  // --- Workday ---
  { id: "salesforce", name: "Salesforce", enabled: true, hqTimeZone: LA, source: { kind: "workday", host: "salesforce.wd12.myworkdayjobs.com", tenant: "salesforce", site: "External_Career_Site" } },
  { id: "adobe", name: "Adobe", enabled: true, hqTimeZone: LA, source: { kind: "workday", host: "adobe.wd5.myworkdayjobs.com", tenant: "adobe", site: "external_experienced" } },
  { id: "nvidia", name: "Nvidia", enabled: true, hqTimeZone: LA, source: { kind: "eightfold", host: "nvidia.eightfold.ai", domain: "nvidia.com" } },
  { id: "paypal", name: "PayPal", enabled: true, hqTimeZone: LA, source: { kind: "eightfold", host: "paypal.eightfold.ai", domain: "paypal.com" } },
  { id: "cisco", name: "Cisco", enabled: true, hqTimeZone: LA, source: { kind: "workday", host: "cisco.wd5.myworkdayjobs.com", tenant: "cisco", site: "Cisco_Careers" } },

  // --- Oracle Cloud HCM ---
  {
    id: "oracle", name: "Oracle", enabled: true, hqTimeZone: "America/Chicago",
    source: { kind: "oracle", host: "eeho.fa.us2.oraclecloud.com", siteNumber: "CX_45001", publicBase: "https://careers.oracle.com/jobs/#en/sites/jobsearch/job/" },
  },

  // --- Greenhouse ---
  { id: "stripe", name: "Stripe", enabled: true, hqTimeZone: LA, source: { kind: "greenhouse", board: "stripe" } },
  { id: "databricks", name: "Databricks", enabled: true, hqTimeZone: LA, source: { kind: "greenhouse", board: "databricks" } },
  { id: "gitlab", name: "GitLab", enabled: true, hqTimeZone: LA, source: { kind: "greenhouse", board: "gitlab" } },
  { id: "coinbase", name: "Coinbase", enabled: true, hqTimeZone: LA, source: { kind: "greenhouse", board: "coinbase" } },
  { id: "cloudflare", name: "Cloudflare", enabled: true, hqTimeZone: LA, source: { kind: "greenhouse", board: "cloudflare" } },
  { id: "rubrik", name: "Rubrik", enabled: true, hqTimeZone: LA, source: { kind: "greenhouse", board: "rubrik" } },
  { id: "twilio", name: "Twilio", enabled: true, hqTimeZone: LA, source: { kind: "greenhouse", board: "twilio" } },
  { id: "mongodb", name: "MongoDB", enabled: true, hqTimeZone: "America/New_York", source: { kind: "greenhouse", board: "mongodb" } },
  { id: "okta", name: "Okta", enabled: true, hqTimeZone: LA, source: { kind: "greenhouse", board: "okta" } },
  { id: "zscaler", name: "Zscaler", enabled: true, hqTimeZone: LA, source: { kind: "greenhouse", board: "zscaler" } },
  { id: "groww", name: "Groww", enabled: true, hqTimeZone: IST, source: { kind: "greenhouse", board: "groww" } },
  { id: "razorpay", name: "Razorpay", enabled: true, hqTimeZone: IST, source: { kind: "greenhouse", board: "razorpaysoftwareprivatelimited" } },

  // --- Lever ---
  { id: "cred", name: "CRED", enabled: true, hqTimeZone: IST, source: { kind: "lever", site: "cred" } },
  { id: "meesho", name: "Meesho", enabled: true, hqTimeZone: IST, source: { kind: "lever", site: "meesho" } },

  { id: "phonepe", name: "PhonePe", enabled: true, hqTimeZone: IST, source: { kind: "smartrecruiters", company: "PHONEPELIMITED" } },
  { id: "intuit", name: "Intuit", enabled: true, hqTimeZone: LA, source: { kind: "radancy", host: "jobs.intuit.com" } },

  // --- Not supported (see docs/sources.md for what was tried) ---
  { id: "walmart", name: "Walmart Global Tech", enabled: false, hqTimeZone: "America/Chicago", source: { kind: "pending", reason: "No public Workday site; robots.txt disallows the careers search API and the sitemap has job ids only" } },
  { id: "goldman", name: "Goldman Sachs", enabled: false, hqTimeZone: "America/New_York", source: { kind: "pending", reason: "robots.txt allows only single role pages; the listing API is undocumented" } },
  { id: "flipkart", name: "Flipkart", enabled: false, hqTimeZone: IST, source: { kind: "pending", reason: "TurboHire API needs a session token and lists about 15 roles; flipkartcareers.com job list is a static page" } },
];
