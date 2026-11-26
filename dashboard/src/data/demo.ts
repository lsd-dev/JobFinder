import { DEFAULT_PROFILE, DEFAULT_SETTINGS, type Company, type CompanyHealth, type JobStage, type JobStatus, type StoredJob } from "../types";
import type { Config, DataSource, Unsubscribe } from "./source";

// Invented sample data for trying the interface (open the dashboard with ?demo).
// The companies and jobs below do not exist; nothing here is read from or
// written to Firestore.

const H = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function job(p: Partial<StoredJob> & Pick<StoredJob, "id" | "companyId" | "companyName" | "title" | "location" | "tier">): StoredJob {
  return {
    externalId: p.id, remote: false, url: "https://example.com/careers/" + p.id, firstSeenAt: iso(2 * H), score: 60,
    reasons: ["entry level", "backend / full-stack title", "skills: node.js, typescript, sql"],
    keywords: [{ term: "node.js", onResume: true }, { term: "typescript", onResume: true }, { term: "kafka", onResume: false }, { term: "sql", onResume: true }, { term: "kubernetes", onResume: false }],
    recruiterTimeZone: "Asia/Kolkata", peakAt: new Date(Date.now() + 14 * H).toISOString(), applyNow: false,
    repostKey: p.id, reposted: false, baseline: false, priority: false, status: "not_applied", closed: false,
    ...p,
  };
}

const JOBS: StoredJob[] = [
  job({ id: "ex_1", companyId: "example", companyName: "Example Corp", title: "Software Engineer I, Backend", location: "Bengaluru", tier: "A", score: 95, priority: true, firstSeenAt: iso(0.4 * H), postedAt: iso(3 * H), pay: "18-24 LPA" }),
  job({ id: "nw_7", companyId: "northwind", companyName: "Northwind Labs", title: "Backend Engineer (New Grad)", location: "Remote (global)", remote: true, tier: "A", score: 85, recruiterTimeZone: "America/Los_Angeles", peakAt: new Date(Date.now() - H).toISOString(), visaOrRelocation: true }),
  job({ id: "ct_3", companyId: "contoso", companyName: "Contoso Systems", title: "Software Development Engineer II", location: "Hyderabad", tier: "B", score: 45, reasons: ["level II", "skills: java, sql"], applyNow: true, firstSeenAt: iso(20 * H) }),
  job({ id: "ex_2", companyId: "example", companyName: "Example Corp", title: "Full Stack Engineer", location: "Pune / Remote", tier: "B", score: 50, priority: true, reposted: true, firstSeenAt: iso(30 * H), reasons: ["backend / full-stack title", "skills: react, node.js"] }),
  job({ id: "nw_9", companyId: "northwind", companyName: "Northwind Labs", title: "Software Engineer", location: "Gurugram", tier: "Maybe", score: 10, reasons: [], keywords: [], baseline: true, firstSeenAt: iso(72 * H) }),
  job({ id: "ct_4", companyId: "contoso", companyName: "Contoso Systems", title: "Platform Engineer, Associate", location: "Noida", tier: "A", score: 80, status: "applied", appliedAt: iso(8 * 24 * H), firstSeenAt: iso(9 * 24 * H), notes: "Referred by a former teammate." }),
  job({ id: "ex_5", companyId: "example", companyName: "Example Corp", title: "API Engineer I", location: "Bengaluru", tier: "A", score: 75, status: "applied", appliedAt: iso(26 * H), firstSeenAt: iso(40 * H), closed: true, closedAt: iso(2 * H), stage: "interview" }),
  job({ id: "nw_2", companyId: "northwind", companyName: "Northwind Labs", title: "Cloud Engineer I", location: "Delhi", tier: "B", score: 40, status: "not_interested", firstSeenAt: iso(50 * H) }),
  job({ id: "ct_8", companyId: "contoso", companyName: "Contoso Systems", title: "Backend Developer, Junior", location: "Bengaluru", tier: "A", score: 70, closed: true, closedAt: iso(5 * H), firstSeenAt: iso(6 * 24 * H) }),
];

const COMPANIES: Company[] = [
  { id: "example", name: "Example Corp", enabled: true, priority: true, hqTimeZone: "America/Los_Angeles", source: { kind: "greenhouse", board: "example" } },
  { id: "northwind", name: "Northwind Labs", enabled: true, hqTimeZone: "America/Los_Angeles", source: { kind: "lever", site: "northwind" } },
  { id: "contoso", name: "Contoso Systems", enabled: true, hqTimeZone: "Asia/Kolkata", source: { kind: "workday", host: "contoso.wd1.myworkdayjobs.com", tenant: "contoso", site: "Careers" } },
  { id: "fabrikam", name: "Fabrikam", enabled: false, hqTimeZone: "Europe/London", source: { kind: "pending", reason: "careers page loads jobs client-side" } },
];

const HEALTH: Record<string, CompanyHealth> = {
  example: { lastScanAt: iso(0.1 * H), ok: true, consecutiveFailures: 0, fetched: 212, matchedNew: 1 },
  northwind: { lastScanAt: iso(0.1 * H), ok: true, consecutiveFailures: 0, fetched: 38, matchedNew: 0 },
  contoso: { lastScanAt: iso(0.1 * H), ok: false, error: "HTTP 429 Too Many Requests", consecutiveFailures: 3, fetched: 0, matchedNew: 0 },
};

class Topic<T> {
  private readonly subs = new Set<(v: T) => void>();
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  set(v: T): void {
    this.value = v;
    for (const s of this.subs) s(v);
  }
  subscribe(cb: (v: T) => void): Unsubscribe {
    this.subs.add(cb);
    queueMicrotask(() => this.subs.has(cb) && cb(this.value));
    return () => void this.subs.delete(cb);
  }
}

export class DemoSource implements DataSource {
  readonly demo = true;
  private readonly jobs = new Topic(JOBS);
  private readonly companies = new Topic(COMPANIES);
  private readonly health = new Topic(HEALTH);
  private config: Config = { profile: DEFAULT_PROFILE, settings: DEFAULT_SETTINGS };

  subscribeJobs(onData: (jobs: StoredJob[]) => void): Unsubscribe {
    return this.jobs.subscribe(onData);
  }
  subscribeCompanies(onData: (companies: Company[]) => void): Unsubscribe {
    return this.companies.subscribe(onData);
  }
  subscribeHealth(onData: (health: Record<string, CompanyHealth>) => void): Unsubscribe {
    return this.health.subscribe(onData);
  }
  async setStatus(jobId: string, status: JobStatus): Promise<void> {
    this.jobs.set(
      this.jobs.get().map((j) => {
        if (j.id !== jobId) return j;
        const { appliedAt: _drop, stage: _stage, ...rest } = j;
        return status === "applied" ? { ...rest, status, appliedAt: new Date().toISOString() } : { ...rest, status };
      }),
    );
  }
  async setStage(jobId: string, stage: JobStage | null): Promise<void> {
    this.jobs.set(
      this.jobs.get().map((j) => {
        if (j.id !== jobId) return j;
        const { stage: _drop, ...rest } = j;
        return stage ? { ...rest, stage } : rest;
      }),
    );
  }
  async setNotes(jobId: string, notes: string): Promise<void> {
    this.jobs.set(this.jobs.get().map((j) => (j.id === jobId ? { ...j, notes } : j)));
  }
  async saveCompany(company: Company): Promise<void> {
    this.companies.set([...this.companies.get().filter((c) => c.id !== company.id), company]);
  }
  async deleteCompany(companyId: string): Promise<void> {
    this.companies.set(this.companies.get().filter((c) => c.id !== companyId));
  }
  async loadConfig(): Promise<Config> {
    return this.config;
  }
  async saveConfig(config: Config): Promise<void> {
    this.config = config;
  }
  async saveDevice(): Promise<void> {
    // Push is not offered with demo data.
  }
  async deleteDevice(): Promise<void> {}
}
