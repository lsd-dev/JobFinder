import { useEffect, useState } from "react";
import type { Toast } from "../App";
import type { Config, DataSource } from "../data/source";
import { forgetKey, linkWithKey } from "../lib/key";
import { disablePush, enablePush, pushStatus, testNotification, type PushStatus } from "../lib/push";
import type { Settings } from "../types";

interface Props {
  source: DataSource;
  spaceKey: string | null;
  onSaved: (s: Settings) => void;
  onForget: () => void;
  onError: (e: unknown) => void;
  toast: (t: Toast) => void;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function SettingsPage({ source, spaceKey, onSaved, onForget, onError, toast }: Props) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [skills, setSkills] = useState("");

  useEffect(() => {
    source.loadConfig().then((c) => {
      setCfg(c);
      setSkills(c.profile.skills.join(", "));
    }, onError);
  }, [source, onError]);

  if (!cfg) return <p className="empty">Loading settings...</p>;
  const s = cfg.settings;
  const patch = (p: Partial<Settings>) => setCfg({ ...cfg, settings: { ...s, ...p } });

  const times = [s.quietHours.start, s.quietHours.end, s.peakWindow.start, s.peakWindow.end, s.eveningFallback];
  const numbersOk = [s.maxYears, s.followUpDays, s.retentionDays].every((n) => Number.isFinite(n) && n >= 0) && s.followUpDays >= 1 && s.retentionDays >= 1;
  const skillList = [...new Set(skills.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 80);
  const valid = times.every((t) => TIME.test(t)) && numbersOk && skillList.length > 0;

  const save = () => {
    const next: Config = { profile: { skills: skillList }, settings: s };
    source.saveConfig(next).then(() => {
      onSaved(s);
      toast({ text: "Settings saved. They apply from the next scan." });
    }, onError);
  };

  const num = (label: string, key: "maxYears" | "followUpDays" | "retentionDays", help: string) => (
    <label>
      {label}
      <input type="number" min={0} max={365} value={Number.isFinite(s[key]) ? s[key] : ""} onChange={(e) => patch({ [key]: e.target.valueAsNumber })} />
      <span className="hint">{help}</span>
    </label>
  );

  return (
    <section>
      <h1>Settings</h1>

      <div className="card">
        <h2>Matching</h2>
        <label>
          Skills on your resume (comma separated)
          <textarea rows={4} value={skills} onChange={(e) => setSkills(e.target.value)} />
          <span className="hint">Used to score roles and to mark which job keywords you already have.</span>
        </label>
        <div className="form-grid">{num("Maximum years required", "maxYears", "Roles asking for more experience are skipped.")}</div>
      </div>

      <div className="card">
        <h2>Reminders</h2>
        <div className="form-grid">
          <label>
            Quiet hours start
            <input type="time" value={s.quietHours.start} onChange={(e) => patch({ quietHours: { ...s.quietHours, start: e.target.value } })} />
          </label>
          <label>
            Quiet hours end
            <input type="time" value={s.quietHours.end} onChange={(e) => patch({ quietHours: { ...s.quietHours, end: e.target.value } })} />
          </label>
          <label>
            Evening reminder time
            <input type="time" value={s.eveningFallback} onChange={(e) => patch({ eveningFallback: e.target.value })} />
            <span className="hint">Used when the recruiter's peak time falls in your quiet hours.</span>
          </label>
          <label>
            Recruiter peak window start
            <input type="time" value={s.peakWindow.start} onChange={(e) => patch({ peakWindow: { ...s.peakWindow, start: e.target.value } })} />
          </label>
          <label>
            Recruiter peak window end
            <input type="time" value={s.peakWindow.end} onChange={(e) => patch({ peakWindow: { ...s.peakWindow, end: e.target.value } })} />
          </label>
          <label>
            Your time zone
            <input value={s.userTimeZone} onChange={(e) => patch({ userTimeZone: e.target.value.trim() })} />
          </label>
          {num("Follow-up after (days)", "followUpDays", "Reminder to follow up on a job you applied to.")}
          {num("Keep unapplied jobs (days)", "retentionDays", "Older jobs you did not apply to are deleted.")}
        </div>
      </div>

      <button className="primary" disabled={!valid} onClick={save}>Save settings</button>
      {!valid && <span className="hint bad-text"> Check the times and numbers above.</span>}

      <Notifications source={source} onError={onError} toast={toast} />

      {spaceKey && (
        <div className="card">
          <h2>This browser</h2>
          <p className="muted">Your key is stored in this browser only. The link below opens the dashboard on another device; treat it like a password.</p>
          <div className="row">
            <button onClick={() => navigator.clipboard.writeText(linkWithKey(spaceKey)).then(() => toast({ text: "Dashboard link copied" }), onError)}>
              Copy dashboard link
            </button>
            <button
              onClick={() => {
                if (!window.confirm("Forget the key on this browser? You will need the key or link to open the dashboard again.")) return;
                // Also stop notifications here; otherwise this browser would keep receiving them.
                void disablePush(source)
                  .catch(() => undefined)
                  .then(() => {
                    forgetKey();
                    onForget();
                  });
              }}
            >
              Forget key on this browser
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const PUSH_TEXT: Record<Exclude<PushStatus, "on" | "off">, string> = {
  demo: "Notifications are not available with demo data.",
  unconfigured: "Notifications are not set up yet: the Web Push key is missing from dashboard/src/firebaseConfig.ts.",
  unsupported: "This browser does not support push notifications. On iPhone and iPad, add the dashboard to the Home Screen first and open it from there.",
  blocked: "Notifications are blocked for this site. Allow them in the browser's site settings, then reload.",
};

function Notifications({ source, onError, toast }: Pick<Props, "source" | "onError" | "toast">) {
  const [status, setStatus] = useState<PushStatus>(() => pushStatus(source));
  const [busy, setBusy] = useState(false);

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    work()
      .catch(onError)
      .finally(() => {
        setStatus(pushStatus(source));
        setBusy(false);
      });
  };

  return (
    <div className="card">
      <h2>Notifications on this device</h2>
      {status === "on" || status === "off" ? (
        <>
          <p className="muted">
            {status === "on"
              ? "On. This browser receives new-match, apply-now and follow-up alerts."
              : "Off. Turn on to receive new-match, apply-now and follow-up alerts in this browser. Each browser or phone is turned on separately."}
          </p>
          <div className="row">
            {status === "off" ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const result = await enablePush(source);
                    if (result === "on") toast({ text: "Notifications are on for this browser" });
                  })
                }
              >
                Turn on notifications
              </button>
            ) : (
              <>
                <button disabled={busy} onClick={() => run(testNotification)}>Show a test notification</button>
                <button disabled={busy} onClick={() => run(() => disablePush(source).then(() => toast({ text: "Notifications are off for this browser" })))}>
                  Turn off
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <p className="muted">{PUSH_TEXT[status]}</p>
      )}
    </div>
  );
}
