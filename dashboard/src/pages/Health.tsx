import { useEffect, useState } from "react";
import { ago } from "../lib/jobs";
import type { Company, CompanyHealth } from "../types";

/** Scans run every 15 minutes; GitHub often delays them, so only warn after 45. */
const STALE_MS = 45 * 60_000;

export function Health({ companies, health }: { companies: Company[]; health: Record<string, CompanyHealth> }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const rows = [...companies].sort((a, b) => a.name.localeCompare(b.name));
  const last = Object.values(health).map((h) => h.lastScanAt).sort().pop();
  const stale = !!last && now.getTime() - new Date(last).getTime() > STALE_MS;
  const failing = rows.filter((c) => health[c.id] && !health[c.id]!.ok);

  return (
    <section>
      <h1>Scanner health</h1>
      {!last ? (
        <div className="banner">No scan has reported yet. The first scan runs once the GitHub workflow and its secrets are set up.</div>
      ) : stale ? (
        <div className="banner bad">Last scan was {ago(last, now)}. Scans should run every 15 minutes; check the GitHub Actions workflow.</div>
      ) : (
        <div className="banner good">Last scan {ago(last, now)}. {failing.length === 0 ? "All sources are working." : `${failing.length} source(s) failing.`}</div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th><th>Status</th><th>Last scan</th><th className="num">Jobs read</th><th className="num">New matches</th><th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const h = health[c.id];
              const status = !c.enabled ? (c.source.kind === "pending" ? "Not supported yet" : "Paused") : !h ? "Waiting for first scan" : h.ok ? "OK" : `Failing (${h.consecutiveFailures} in a row)`;
              const cls = !c.enabled || !h ? "muted" : h.ok ? "good-text" : "bad-text";
              return (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className={cls}>{status}</td>
                  <td>{h ? ago(h.lastScanAt, now) : ""}</td>
                  <td className="num">{h?.ok ? h.fetched : ""}</td>
                  <td className="num">{h?.ok ? h.matchedNew : ""}</td>
                  <td className="detail">{c.source.kind === "pending" ? c.source.reason : (h?.error ?? "")}</td>
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
