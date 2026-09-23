import { Component, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useCandidate } from "../lib/context";

type Theme = "light" | "dark";

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("cand-theme", next);
    } catch {
      // storage unavailable
    }
    setTheme(next);
  };
  return <button className="btn ghost small" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>;
}

export function Shell() {
  const { profile } = useCandidate();
  return (
    <>
      <header className="cand-header">
        <div className="cand-brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)" /><path d="M9 17.5l4.5 4.5L23 11" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div>
            <div className="cand-brand-name">GapVise AI</div>
            <div className="cand-brand-sub">Virtusa AI Assessment</div>
          </div>
        </div>
        <div className="cand-header-right">
          {profile && <span><strong>{profile.empName}</strong> · <span className="mono">{profile.empId}</span></span>}
          <ThemeToggle />
        </div>
      </header>
      <main className="cand-main">
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card" role="alert" style={{ maxWidth: 520, margin: "60px auto" }}>
        <h2>Something went wrong</h2>
        <p className="muted">Your submitted answers are safe. Reload the page to continue where you left off.</p>
        <button className="btn" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}

export function RequireProfile({ children }: { children: ReactNode }) {
  const { loading, profile, interview, consentGiven } = useCandidate();
  if (loading) return null;
  if (!profile) return <Navigate to="/interview/login" replace />;
  if (interview?.done) return <Navigate to="/interview/end" replace />;
  if (interview && consentGiven) return <Navigate to="/interview/session" replace />;
  return <>{children}</>;
}

export function RequireActiveInterview({ children }: { children: ReactNode }) {
  const { loading, profile, interview, consentGiven } = useCandidate();
  if (loading) return null;
  if (!profile) return <Navigate to="/interview/login" replace />;
  if (!interview || !consentGiven) return <Navigate to="/interview/instructions" replace />;
  return <>{children}</>;
}

export function RequireFinishedInterview({ children }: { children: ReactNode }) {
  const { loading, interview } = useCandidate();
  if (loading) return null;
  if (!interview?.done) return <Navigate to="/interview/login" replace />;
  return <>{children}</>;
}
