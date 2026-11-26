import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataSource } from "./data/source";
import { DemoSource } from "./data/demo";
import { FirestoreSource } from "./data/firestore";
import { readKey } from "./lib/key";
import { refreshPush } from "./lib/push";
import { DEFAULT_SETTINGS, type Company, type CompanyHealth, type JobStatus, type Settings, type StoredJob } from "./types";
import { KeyScreen } from "./pages/KeyScreen";
import { Feed } from "./pages/Feed";
import { Watchlist } from "./pages/Watchlist";
import { Health } from "./pages/Health";
import { SettingsPage } from "./pages/Settings";

type Tab = "jobs" | "watchlist" | "health" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "jobs", label: "Jobs" },
  { id: "watchlist", label: "Watchlist" },
  { id: "health", label: "Health" },
  { id: "settings", label: "Settings" },
];

export interface Toast {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function App() {
  const isDemo = useMemo(() => new URLSearchParams(window.location.search).has("demo"), []);
  const [key, setKey] = useState<string | null>(() => (isDemo ? null : readKey()));
  const source = useMemo<DataSource | null>(() => (isDemo ? new DemoSource() : key ? new FirestoreSource(key) : null), [isDemo, key]);

  if (!source) return <KeyScreen onKey={setKey} />;
  return <Dashboard source={source} spaceKey={key} onForget={() => setKey(null)} />;
}

function Dashboard({ source, spaceKey, onForget }: { source: DataSource; spaceKey: string | null; onForget: () => void }) {
  // The weekly health notification opens /?tab=health.
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get("tab") === "health" ? "health" : "jobs"));
  const [jobs, setJobs] = useState<StoredJob[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [health, setHealth] = useState<Record<string, CompanyHealth>>({});
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const fail = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    setError(/permission|insufficient/i.test(msg) ? "Access denied. Check that the key is correct and the Firestore rules are deployed." : msg);
  }, []);

  useEffect(() => {
    const subs = [source.subscribeJobs(setJobs, fail), source.subscribeCompanies(setCompanies, fail), source.subscribeHealth(setHealth, fail)];
    source.loadConfig().then((c) => setSettings(c.settings), fail);
    // Keeps this browser's push registration current; a failure here is not worth an error banner.
    refreshPush(source).catch(() => undefined);
    return () => subs.forEach((u) => u());
  }, [source, fail]);

  const showToast = useCallback((t: Toast) => {
    window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), 8000);
  }, []);

  const setStatus = useCallback(
    (job: StoredJob, status: JobStatus, undoable = true) => {
      const previous = job.status;
      if (previous === status) return;
      source.setStatus(job.id, status).then(() => {
        const label = status === "applied" ? "Marked as applied" : status === "not_interested" ? "Hidden. No more reminders for this job" : "Marked as not applied";
        showToast(undoable ? { text: label, actionLabel: "Undo", onAction: () => setStatus({ ...job, status }, previous, false) } : { text: label });
      }, fail);
    },
    [source, fail, showToast],
  );

  const failing = Object.values(health).filter((h) => !h.ok).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width="24" height="24" />
          <span>JobFinder</span>
          {source.demo && <span className="tag warn">Demo data</span>}
        </div>
        <nav aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "tab active" : "tab"} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "health" && failing > 0 && <span className="dot bad" title={`${failing} failing`} />}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <div className="banner bad" role="alert">
          {error} <button className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main>
        {tab === "jobs" && <Feed jobs={jobs} companies={companies} settings={settings} source={source} onStatus={setStatus} onError={fail} toast={showToast} />}
        {tab === "watchlist" && <Watchlist companies={companies} health={health} source={source} onError={fail} toast={showToast} />}
        {tab === "health" && <Health companies={companies} health={health} />}
        {tab === "settings" && <SettingsPage source={source} spaceKey={spaceKey} onSaved={setSettings} onForget={onForget} onError={fail} toast={showToast} />}
      </main>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.actionLabel && (
            <button
              className="link"
              onClick={() => {
                toast.onAction?.();
                setToast(null);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
