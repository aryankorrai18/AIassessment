import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  IconActivity, IconCalendar, IconChart, IconCpu, IconFile, IconHistory, IconList, IconLogo, IconLogout,
  IconMoon, IconOverview, IconSettings, IconShield, IconSun, IconUsers,
} from "./Icons";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("admin-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // storage unavailable
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("admin-theme", next);
    } catch {
      // storage unavailable; the toggle still works for this visit
    }
    setTheme(next);
  };
  return [theme, toggle];
}

interface NavItem { to: string; label: string; icon: ReactNode }
interface NavGroup { title: string; items: NavItem[]; masterOnly?: boolean }

const NAV: NavGroup[] = [
  { title: "Dashboard", items: [{ to: "/admin/overview", label: "Overview", icon: <IconOverview /> }] },
  {
    title: "Upload Candidates and JD",
    items: [
      { to: "/admin/candidates", label: "Candidates", icon: <IconUsers /> },
      { to: "/admin/jd-master", label: "JD Master", icon: <IconFile /> },
      { to: "/admin/question-bank", label: "Question Bank", icon: <IconList /> },
    ],
  },
  {
    title: "Interviews",
    items: [
      { to: "/admin/schedule", label: "Interview Schedule", icon: <IconCalendar /> },
      { to: "/admin/live-monitor", label: "Live Monitor", icon: <IconActivity /> },
    ],
  },
  {
    title: "Insights",
    items: [
      { to: "/admin/results", label: "Results", icon: <IconChart /> },
      { to: "/admin/api-usage", label: "API Usage", icon: <IconCpu /> },
    ],
  },
  {
    title: "Administration",
    masterOnly: true,
    items: [
      { to: "/admin/users", label: "Admin Users", icon: <IconShield /> },
      { to: "/admin/audit-log", label: "Audit Log", icon: <IconHistory /> },
      { to: "/admin/settings", label: "Settings", icon: <IconSettings /> },
    ],
  },
];

export function Shell() {
  const { admin, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const { pathname } = useLocation();
  const isMaster = admin?.role === "MASTER_ADMIN";

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name"><IconLogo /> GapVise AI</div>
          <div className="brand-sub">Admin Dashboard</div>
        </div>
        <nav className="nav" aria-label="Main">
          {/* MASTER-only groups are filtered out of the DOM entirely, header included. */}
          {NAV.filter((g) => !g.masterOnly || isMaster).map((g) => (
            <div key={g.title}>
              <div className="nav-group-title">{g.title}</div>
              {g.items.map((item) => (
                <NavLink key={item.to} to={item.to}>{item.icon}{item.label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="identity">
          <div>
            <Link to="/admin/profile" className="identity-name">{admin?.name}</Link>
            <div className="identity-role">{admin?.role}</div>
          </div>
          <div className="identity-actions">
            <button className="btn secondary small" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              {theme === "dark" ? <IconSun /> : <IconMoon />}{theme === "dark" ? "Light" : "Dark"}
            </button>
            <button className="btn secondary small" onClick={() => void logout()}><IconLogout />Sign out</button>
          </div>
        </div>
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        {/* Inside the shell, keyed on pathname: a page crash leaves the sidebar usable, and navigating clears it. */}
        <ErrorBoundary key={pathname}>
          <Suspense fallback={<div className="muted">Loading…</div>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { admin, loading } = useAuth();
  if (loading) return null; // avoids flashing a redirect
  if (!admin) return <Navigate to="/admin/login" replace />;
  return <>{children}</>;
}

/** Wrong role is a different situation from being logged out: an in-page 403, not a redirect. */
export function RequireMasterAdmin({ children }: { children: ReactNode }) {
  const { admin } = useAuth();
  if (admin?.role !== "MASTER_ADMIN") {
    return (
      <div className="card forbidden" role="alert">
        <h2>403 — Master admins only</h2>
        <p className="muted">This page is limited to MASTER_ADMIN accounts. Ask a master admin if you need access.</p>
      </div>
    );
  }
  return <>{children}</>;
}
