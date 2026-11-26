import { useEffect, useMemo, useRef, useState } from "react";
import type { Toast } from "../App";
import type { DataSource } from "../data/source";
import { ago, applyFilters, countViews, DEFAULT_FILTERS, followUpDue, linkedInSearch, peakLabel, referralMessage, viewOf, type Filters, type View } from "../lib/jobs";
import type { Company, JobStatus, Settings, StoredJob, Tier } from "../types";

const VIEWS: { id: View; label: string }[] = [
  { id: "todo", label: "To apply" },
  { id: "applied", label: "Applied" },
  { id: "hidden", label: "Not interested" },
  { id: "closed", label: "Closed" },
];
const TIERS: Tier[] = ["A", "B", "Maybe"];
const EMPTY: Record<View, string> = {
  todo: "No open matches right now. New ones appear here as soon as a scan finds them.",
  applied: "Nothing marked as applied yet. Clicking Apply on a job moves it here.",
  hidden: "No hidden jobs.",
  closed: "No closed postings.",
};

interface Props {
  jobs: StoredJob[] | null;
  companies: Company[];
  settings: Settings;
  source: DataSource;
  onStatus: (job: StoredJob, status: JobStatus) => void;
  onError: (e: unknown) => void;
  toast: (t: Toast) => void;
}

export function Feed({ jobs, companies, settings, source, onStatus, onError, toast }: Props) {
  // Grouped notifications link to a list: /?view=applied for follow-ups, the "To apply" list otherwise.
  const [filters, setFilters] = useState<Filters>(() =>
    new URLSearchParams(window.location.search).get("view") === "applied" ? { ...DEFAULT_FILTERS, view: "applied" } : DEFAULT_FILTERS,
  );
  const [now, setNow] = useState(() => new Date());
  const linked = useMemo(() => new URLSearchParams(window.location.search).get("job"), []);
  const jumped = useRef(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Opened from a notification (/?job=<id>): show the list that job is in and scroll to it.
  useEffect(() => {
    if (!linked || !jobs || jumped.current) return;
    const j = jobs.find((x) => x.id === linked);
    if (!j) return;
    jumped.current = true;
    setFilters({ ...DEFAULT_FILTERS, view: viewOf(j) });
    window.setTimeout(() => document.getElementById(`job-${linked}`)?.scrollIntoView({ block: "center" }), 50);
  }, [linked, jobs]);

  const counts = useMemo(() => countViews(jobs ?? []), [jobs]);
  const visible = useMemo(() => applyFilters(jobs ?? [], filters), [jobs, filters]);
  const companyOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const j of jobs ?? []) names.set(j.companyId, j.companyName);
    for (const c of companies) if (names.has(c.id)) names.set(c.id, c.name);
    return [...names].sort((a, b) => a[1].localeCompare(b[1]));
  }, [jobs, companies]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggleTier = (t: Tier) => {
    const tiers = new Set(filters.tiers);
    if (tiers.has(t)) tiers.delete(t);
    else tiers.add(t);
    set({ tiers });
  };

  return (
    <>
      <div className="views" role="tablist" aria-label="Job lists">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={filters.view === v.id} className={filters.view === v.id ? "view active" : "view"} onClick={() => set({ view: v.id })}>
            {v.label} <span className="count">{counts[v.id]}</span>
          </button>
        ))}
      </div>

      <div className="filters">
        <input type="search" placeholder="Search title, company, skill" aria-label="Search jobs" value={filters.query} onChange={(e) => set({ query: e.target.value })} />
        <select aria-label="Company" value={filters.companyId} onChange={(e) => set({ companyId: e.target.value })}>
          <option value="">All companies</option>
          {companyOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <div className="chips" role="group" aria-label="Tiers">
          {TIERS.map((t) => (
            <button key={t} className={filters.tiers.has(t) ? `chip tier-${t} on` : "chip"} aria-pressed={filters.tiers.has(t)} onClick={() => toggleTier(t)}>
              {t === "Maybe" ? "Maybe" : `Tier ${t}`}
            </button>
          ))}
          <button className={filters.remoteOnly ? "chip on" : "chip"} aria-pressed={filters.remoteOnly} onClick={() => set({ remoteOnly: !filters.remoteOnly })}>
            Remote only
          </button>
        </div>
        {filters.view !== "applied" && (
          <select aria-label="Sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"] })}>
            <option value="newest">Most recently posted</option>
            <option value="score">Best match first</option>
          </select>
        )}
      </div>

      {jobs === null ? (
        <p className="empty">Loading jobs...</p>
      ) : visible.length === 0 ? (
        <p className="empty">{counts[filters.view] === 0 ? EMPTY[filters.view] : "No jobs match these filters."}</p>
      ) : (
        <ul className="jobs">
          {visible.map((j) => (
            <JobCard key={j.id} job={j} now={now} settings={settings} highlight={j.id === linked} source={source} onStatus={onStatus} onError={onError} toast={toast} />
          ))}
        </ul>
      )}
    </>
  );
}

interface CardProps extends Pick<Props, "settings" | "source" | "onStatus" | "onError" | "toast"> {
  job: StoredJob;
  now: Date;
  highlight: boolean;
}

function JobCard({ job: j, now, settings, highlight, source, onStatus, onError, toast }: CardProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(j.notes ?? "");
  useEffect(() => setNotes(j.notes ?? ""), [j.notes]);

  const peak = peakLabel(j, now);
  const due = followUpDue(j, settings.followUpDays, now);

  const saveNotes = () => {
    if (notes === (j.notes ?? "")) return;
    source.setNotes(j.id, notes).then(() => toast({ text: "Notes saved" }), onError);
  };
  const copyMessage = () => navigator.clipboard.writeText(referralMessage(j)).then(() => toast({ text: "Referral message copied" }), onError);

  return (
    <li id={`job-${j.id}`} className={highlight ? "job highlight" : "job"}>
      <div className="job-head">
        <span className={`tier tier-${j.tier}`} title="Match tier">{j.tier === "Maybe" ? "Maybe" : `Tier ${j.tier}`}</span>
        <div className="job-title">
          <a href={j.url} target="_blank" rel="noopener noreferrer">{j.title}</a>
          <div className="meta">
            <strong>{j.companyName}</strong> · {j.location}
            {j.postedAt && <> · posted {ago(j.postedAt, now)}</>} · found {ago(j.firstSeenAt, now)}
            {j.appliedAt && <> · applied {ago(j.appliedAt, now)}</>}
          </div>
        </div>
        <div className="job-actions">
          {j.status !== "applied" && !j.closed && (
            <a className="button primary" href={j.url} target="_blank" rel="noopener noreferrer" onClick={() => onStatus(j, "applied")}>
              Apply
            </a>
          )}
          <select aria-label={`Status of ${j.title}`} value={j.status} onChange={(e) => onStatus(j, e.target.value as JobStatus)}>
            <option value="not_applied">Not applied</option>
            <option value="applied">Applied</option>
            <option value="not_interested">Not interested</option>
          </select>
        </div>
      </div>

      <div className="tags">
        {j.closed && <span className="tag bad">Closed{j.closedAt ? ` ${ago(j.closedAt, now)}` : ""}</span>}
        {due && <span className="tag warn">Follow up</span>}
        {peak && <span className={peak.urgent ? "tag warn" : "tag"}>{peak.text}</span>}
        {j.priority && <span className="tag accent">Priority company</span>}
        {j.remote && <span className="tag">Remote</span>}
        {j.reposted && <span className="tag">Repost</span>}
        {j.baseline && <span className="tag" title="Already open when this company was first scanned, so its real age is unknown">Open before first scan</span>}
        {j.pay && <span className="tag good">{j.pay}</span>}
        {j.visaOrRelocation && <span className="tag good">Visa / relocation mentioned</span>}
      </div>

      {j.reasons.length > 0 && <p className="why">Why it matched: {j.reasons.join(" · ")}</p>}

      {j.keywords.length > 0 && (
        <div className="keywords" aria-label="Top keywords in the job description">
          {j.keywords.map((k) => (
            <span key={k.term} className={k.onResume ? "kw have" : "kw"} title={k.onResume ? "On your resume" : "Not on your resume"}>
              {k.term}
            </span>
          ))}
        </div>
      )}

      <div className="job-foot">
        <a href={linkedInSearch(j, "manager")} target="_blank" rel="noopener noreferrer">Find hiring manager</a>
        <a href={linkedInSearch(j, "referral")} target="_blank" rel="noopener noreferrer">Find a referral</a>
        <button className="link" onClick={copyMessage}>Copy referral message</button>
        <button className="link" aria-expanded={notesOpen} onClick={() => setNotesOpen((o) => !o)}>
          {j.notes ? "Notes (1)" : "Add notes"}
        </button>
      </div>

      {notesOpen && (
        <textarea
          aria-label={`Notes for ${j.title}`}
          value={notes}
          maxLength={2000}
          rows={3}
          placeholder="Recruiter name, referral status, interview dates... Saved when you click away."
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
        />
      )}
    </li>
  );
}
