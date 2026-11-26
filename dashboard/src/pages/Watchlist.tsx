import { useMemo, useState } from "react";
import type { Toast } from "../App";
import type { DataSource } from "../data/source";
import { detectAts, slugify } from "../lib/detectAts";
import { COMMON_ZONES as ZONES } from "../lib/zones";
import type { Company, CompanyHealth } from "../types";


interface Props {
  companies: Company[];
  health: Record<string, CompanyHealth>;
  source: DataSource;
  onError: (e: unknown) => void;
  toast: (t: Toast) => void;
}

export function Watchlist({ companies, health, source, onError, toast }: Props) {
  const rows = useMemo(() => [...companies].sort((a, b) => a.name.localeCompare(b.name)), [companies]);
  const save = (c: Company) => source.saveCompany(c).catch(onError);
  const remove = (c: Company) => {
    if (!window.confirm(`Remove ${c.name} from the watchlist? Its stored jobs stay until they expire.`)) return;
    source.deleteCompany(c.id).then(() => toast({ text: `${c.name} removed`, actionLabel: "Undo", onAction: () => void save(c) }), onError);
  };

  return (
    <section>
      <h1>Watchlist</h1>
      <p className="muted">
        {rows.filter((c) => c.enabled).length} of {rows.length} companies are scanned every 15 minutes. Priority companies send notifications that stay on
        screen until dismissed.
      </p>
      <AddCompany existing={companies} onAdd={(c) => source.saveCompany(c).then(() => toast({ text: `${c.name} added` }), onError)} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Company</th><th>Source</th><th>Scan</th><th>Priority</th><th>Recruiter time zone</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const pending = c.source.kind === "pending";
              const h = health[c.id];
              return (
                <tr key={c.id}>
                  <td>
                    {c.name} {h && !h.ok && c.enabled && <span className="dot bad" title={h.error ?? "failing"} />}
                  </td>
                  <td className={pending ? "muted" : undefined} title={c.source.kind === "pending" ? c.source.reason : undefined}>
                    {pending ? "Not supported yet" : c.source.kind}
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`Scan ${c.name}`} checked={c.enabled} disabled={pending} onChange={(e) => void save({ ...c, enabled: e.target.checked })} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`${c.name} is a priority company`} checked={!!c.priority} onChange={(e) => void save({ ...c, priority: e.target.checked })} />
                  </td>
                  <td>
                    <select aria-label={`Time zone for ${c.name}`} value={c.hqTimeZone} onChange={(e) => void save({ ...c, hqTimeZone: e.target.value })}>
                      {!ZONES.some(([z]) => z === c.hqTimeZone) && <option value={c.hqTimeZone}>{c.hqTimeZone}</option>}
                      {ZONES.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
                    </select>
                  </td>
                  <td><button className="link bad-text" onClick={() => remove(c)}>Remove</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty">The watchlist is empty until the scanner's first run seeds it.</p>}
    </section>
  );
}

function AddCompany({ existing, onAdd }: { existing: Company[]; onAdd: (c: Company) => Promise<void> }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [zone, setZone] = useState("America/Los_Angeles");
  const [test, setTest] = useState<string | null>(null);

  const detected = useMemo(() => detectAts(url), [url]);
  const id = slugify(name);
  const duplicate = !!id && existing.some((c) => c.id === id);
  const canAdd = !!id && !duplicate && url.trim() !== "";

  const runTest = async () => {
    if (!detected?.testUrl) return;
    setTest("Checking...");
    try {
      const res = await fetch(detected.testUrl, { referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      const list = Array.isArray(body) ? body : (body as { jobs?: unknown[] }).jobs;
      const total = (body as { totalFound?: unknown }).totalFound; // SmartRecruiters reports a count
      const count = Array.isArray(list) ? list.length : typeof total === "number" ? total : null;
      setTest(count !== null ? `Works: ${count} open jobs listed.` : "Reached the site, but the response was not a job list.");
    } catch (e) {
      setTest(`Could not read it from the browser (${e instanceof Error ? e.message : "error"}). The scanner may still be able to.`);
    }
  };

  const add = () => {
    const company: Company = detected
      ? { id, name: name.trim(), enabled: true, hqTimeZone: zone, source: detected.source }
      : { id, name: name.trim(), enabled: false, hqTimeZone: zone, note: url.trim().slice(0, 300), source: { kind: "pending", reason: "Careers system not recognised; needs a custom adapter" } };
    void onAdd(company).then(() => {
      setName("");
      setUrl("");
      setTest(null);
    });
  };

  return (
    <div className="card">
      <h2>Add a company</h2>
      <div className="form-grid">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Company name" />
        </label>
        <label>
          Careers page URL
          <input value={url} onChange={(e) => { setUrl(e.target.value); setTest(null); }} placeholder="https://boards.greenhouse.io/..." inputMode="url" />
        </label>
        <label>
          Recruiter time zone
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            {ZONES.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
          </select>
        </label>
      </div>
      {url.trim() !== "" && (
        <p className="hint">
          {detected
            ? `Detected: ${detected.label}.`
            : "Not a Greenhouse, Lever, Workday or SmartRecruiters URL. It will be saved as \"not supported yet\" and will not be scanned."}
          {detected?.testUrl && <> <button className="link" onClick={() => void runTest()}>Test it</button></>}
          {detected && !detected.testUrl && " Workday can only be checked by the scanner."}
          {test && <> {test}</>}
        </p>
      )}
      {duplicate && <p className="hint bad-text">A company with this name is already on the watchlist.</p>}
      <button className="primary" disabled={!canAdd} onClick={add}>Add to watchlist</button>
    </div>
  );
}
