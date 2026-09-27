import { Component, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { IconLogo, IconMoon, IconSun } from "./Icons";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useCandidate } from "../lib/context";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b1020" : "#f4f6fa");
  }, [theme]);
  const next = theme === "dark" ? "light" : "dark";
  const toggle = () => {
    try {
      localStorage.setItem("cand-theme", next);
    } catch {
      // storage unavailable
    }
    setTheme(next);
  };
  return (
    <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
    </button>
  );
}

export function Brand() {
  return (
    <div className="cand-brand">
      <IconLogo size={30} />
      <span className="cand-brand-name">GapVise <b>AI</b></span>
    </div>
  );
}

export function Shell() {
  const { profile } = useCandidate();
  // The interview screen draws its own session bar (clock, progress, proctoring).
  const inSession = useLocation().pathname.endsWith("/session");
  const fallback = <p className="muted" style={{ padding: 24 }}>Loading…</p>;
  if (inSession) {
    return <Suspense fallback={fallback}><Outlet /></Suspense>;
  }
  return (
    <>
      <header className="cand-header">
        <Brand />
        <div className="cand-header-right">
          {profile && (
            <div className="cand-who">
              <strong>{profile.name}</strong>
              <span>{profile.email}</span>
            </div>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="cand-main">
        <Suspense fallback={fallback}>
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
      <div className="panel crash" role="alert">
        <h1 className="page-title" style={{ fontSize: 30 }}>This page stopped working</h1>
        <p className="muted">Every answer you submitted is saved. Reload to continue from the question you were on.</p>
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
