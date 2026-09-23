import { useEffect, useRef, type ReactNode } from "react";
import type { InterviewStatus, IntegrityVerdict } from "../lib/types";

export function CategoryPill({ category }: { category: string | null }) {
  if (!category) return <span className="faint">—</span>;
  const tone = category === "Category 1" ? "ok" : category === "Category 2" ? "warn" : "err";
  return <span className={`pill ${tone}`}>{category}</span>;
}

export function VerdictPill({ verdict }: { verdict: IntegrityVerdict }) {
  const tone = verdict === "Clean" ? "ok" : verdict.startsWith("Major") ? "err" : "warn";
  return <span className={`pill ${tone}`}>{verdict}</span>;
}

const STATUS_TONE: Record<InterviewStatus, string> = { PENDING: "warn", ACTIVE: "ok", COMPLETED: "ok", NO_SHOW: "err", EXPIRED: "err" };
const STATUS_ICON: Record<InterviewStatus, string> = { PENDING: "◷", ACTIVE: "●", COMPLETED: "✓", NO_SHOW: "✕", EXPIRED: "⊘" };

export function StatusPill({ status, icon = false }: { status: InterviewStatus | null; icon?: boolean }) {
  if (!status) return <span className="faint">—</span>;
  return <span className={`pill ${STATUS_TONE[status]}`}>{icon ? `${STATUS_ICON[status]} ` : ""}{status}</span>;
}

/** role="dialog" aria-modal="true"; click-outside closes unless `locked`. Focus moves into the dialog. */
export function Modal({ title, onClose, locked, children }: { title: string; onClose: () => void; locked?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return <tr><td colSpan={colSpan} className="empty">{children}</td></tr>;
}
