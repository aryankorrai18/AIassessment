import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { IconAlert, IconBan, IconCheck, IconClock, IconLive, IconMore, IconX } from "../components/Icons";
import type { InterviewStatus, IntegrityVerdict } from "../lib/types";

export function CategoryPill({ category }: { category: string | null }) {
  if (!category) return <span className="faint">—</span>;
  const tone = category === "Category 1" ? "ok" : category === "Category 2" ? "warn" : "err";
  return <span className={`pill ${tone}`}>{category}</span>;
}

export function VerdictPill({ verdict }: { verdict: IntegrityVerdict }) {
  const tone = verdict === "Clean" ? "ok" : verdict.startsWith("Major") ? "err" : "warn";
  const icon = tone === "ok" ? <IconCheck size={12} /> : <IconAlert size={12} />;
  return <span className={`pill ${tone}`}>{icon}{verdict}</span>;
}

const STATUS_TONE: Record<InterviewStatus, string> = { PENDING: "warn", ACTIVE: "info", COMPLETED: "ok", NO_SHOW: "err", EXPIRED: "err" };
const STATUS_LABEL: Record<InterviewStatus, string> = { PENDING: "Pending", ACTIVE: "Active", COMPLETED: "Completed", NO_SHOW: "No-show", EXPIRED: "Expired" };
const STATUS_ICON: Record<InterviewStatus, ReactNode> = {
  PENDING: <IconClock size={12} />, ACTIVE: <IconLive size={12} />, COMPLETED: <IconCheck size={12} />, NO_SHOW: <IconX size={12} />, EXPIRED: <IconBan size={12} />,
};

/** Interview status badge: an SVG icon (never an emoji) plus a readable label; the tone carries the meaning, the label repeats it. */
export function StatusPill({ status }: { status: InterviewStatus | null; icon?: boolean }) {
  if (!status) return <span className="faint">—</span>;
  return <span className={`pill ${STATUS_TONE[status]}`}>{STATUS_ICON[status]}{STATUS_LABEL[status]}</span>;
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

export interface RowMenuItem { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; title?: string; icon?: ReactNode }

/**
 * Compact "More actions" menu for table rows (keeps rarely-used and destructive actions
 * out of the row). Arrow keys move between items, Escape closes and returns focus.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const first = wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    first?.focus();
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const els = [...(wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className="row-menu" ref={wrapRef} onKeyDown={onKeyDown}>
      <button ref={buttonRef} type="button" className="btn secondary small icon-only" aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <IconMore />
      </button>
      {open && (
        <div className="row-menu-list" role="menu" aria-label={label}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={`row-menu-item${it.danger ? " danger" : ""}`}
              disabled={it.disabled} title={it.title} onClick={() => { setOpen(false); it.onSelect(); }}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
