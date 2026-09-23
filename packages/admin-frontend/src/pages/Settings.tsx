import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useToast } from "../components/Toast";
import { api, errorMessage } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { GeminiKeyStatus } from "../lib/types";

export default function Settings() {
  const toast = useToast();
  const [status, setStatus] = useState<GeminiKeyStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<GeminiKeyStatus>("/settings/gemini-key"));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setStatus(await api<GeminiKeyStatus>("/settings/gemini-key", { body: { apiKey: key } }));
      setKey("");
      toast("Gemini API key updated — takes effect on the very next call, no restart needed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!window.confirm("Clear the admin-managed Gemini key and revert to the key in the server's .env file?")) return;
    try {
      await api("/settings/gemini-key", { method: "DELETE" });
      toast("Cleared — reverted to the .env key.");
      await load();
    } catch (err) {
      toast(errorMessage(err), "err");
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Rotate the Gemini API key without a redeploy. The key is validated against Gemini before it's saved and is never shown in full again.</p>
        </div>
      </div>
      <form className="card" onSubmit={save} style={{ maxWidth: 640 }}>
        <h2>Gemini API key</h2>
        <p style={{ marginTop: 0 }}>
          {!status ? <span className="muted">Loading…</span>
            : status.isSet ? <><span className="pill ok">✓ Configured</span> <span className="mono">{status.maskedKey}</span> <span className="muted">— set by {status.updatedByName} on {fmtDateTime(status.updatedAt)}</span></>
            : status.usingEnvFallback ? <span className="pill warn">Using the .env key — not yet admin-managed</span>
            : <span className="pill err">✕ No Gemini API key configured anywhere</span>}
        </p>
        <div className="form-field" style={{ marginBottom: 12 }}>
          <label htmlFor="gemini-key">{status?.isSet ? "Replace with a new key" : "Paste a Gemini API key"}</label>
          <input id="gemini-key" type="password" autoComplete="off" placeholder="AIza…" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn" type="submit" disabled={busy || !key.trim()}>{busy ? "Validating & saving…" : "Save key"}</button>
          {status?.isSet && <button className="btn secondary" type="button" onClick={() => void clear()}>Clear (revert to .env)</button>}
        </div>
      </form>
    </>
  );
}
