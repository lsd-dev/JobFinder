import { useState } from "react";
import { generateKey, isValidKey, keyFromHash, linkWithKey, MIN_KEY_LENGTH, saveKey } from "../lib/key";

/** Shown when this browser has no space key yet. */
export function KeyScreen({ onKey }: { onKey: (k: string) => void }) {
  const [input, setInput] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  // Accept either the bare key or a full dashboard link containing #k=...
  const hashAt = input.indexOf("#k=");
  const candidate = hashAt >= 0 ? (keyFromHash(input.slice(hashAt).trim()) ?? "") : input.trim();
  const valid = isValidKey(candidate);

  const use = (k: string) => {
    saveKey(k);
    onKey(k);
  };
  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => setCopied(what), () => setCopied(""));

  return (
    <div className="center">
      <div className="card narrow">
        <h1>JobFinder</h1>
        <p className="muted">
          There is no sign-in. Your data is protected by a private key. Paste the key (or your dashboard link) to open it on this browser.
        </p>
        <label htmlFor="key">Key or link</label>
        <input id="key" type="password" autoComplete="off" value={input} onChange={(e) => setInput(e.target.value)} placeholder={`${MIN_KEY_LENGTH}+ characters`} />
        {input && !valid && <p className="hint bad-text">That does not look like a valid key.</p>}
        <div className="row">
          <button className="primary" disabled={!valid} onClick={() => use(candidate)}>Open dashboard</button>
          <a className="link" href="/?demo">Try the demo</a>
        </div>

        <hr />
        <h2>First time?</h2>
        {!fresh ? (
          <>
            <p className="muted">Create a key once, then give the same key to the scanner.</p>
            <button onClick={() => setFresh(generateKey())}>Create a new key</button>
          </>
        ) : (
          <>
            <p className="muted">
              Save this now: it is not shown again. Add it to your GitHub repository as the Actions secret <code>SPACE_KEY</code>, and keep the link
              for your other devices. Anyone with the key can read and edit your data.
            </p>
            <code className="block">{fresh}</code>
            <div className="row">
              <button onClick={() => copy("key", fresh)}>{copied === "key" ? "Copied" : "Copy key"}</button>
              <button onClick={() => copy("link", linkWithKey(fresh))}>{copied === "link" ? "Copied" : "Copy dashboard link"}</button>
              <button className="primary" onClick={() => use(fresh)}>I saved it, continue</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
