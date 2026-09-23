import { useEffect, useRef, type RefObject } from "react";
import type { Proctoring } from "./useProctoring";

const OBJECT_MESSAGES: Record<string, string> = {
  "cell phone": "Phone detected in frame",
  book: "Book or notes detected in frame",
  laptop: "A second laptop or screen detected in frame",
  tv: "A TV or monitor detected in frame",
  remote: "A remote control detected in frame",
};

/** Tier 1 — an ordinary mirrored self-view. Never a diagnostic overlay: no mesh, boxes or score. */
export function SelfView({ videoRef, cameraError }: { videoRef: RefObject<HTMLVideoElement | null>; cameraError: string | null }) {
  if (cameraError) {
    return <div className="self-view self-view-error" role="status">Proctoring couldn't start: {cameraError}</div>;
  }
  return <video ref={videoRef} className="self-view" muted playsInline aria-hidden="true" />;
}

/** Tier 2 — stackable, non-blocking banners (more than one can legitimately be true at once). */
export function Banners({ p }: { p: Proctoring }) {
  const items: string[] = [];
  if (p.faceState === "none") items.push("No face detected — please stay visible in frame");
  if (p.faceState === "multiple") items.push("Multiple faces detected — only you should be visible in frame");
  if (p.objectAlert) items.push(OBJECT_MESSAGES[p.objectAlert] ?? "Prohibited item detected in frame");
  if (items.length === 0) return null;
  return (
    <div className="banner-stack">
      {items.map((t) => <div key={t} className="proctor-banner" role="alert">{t}</div>)}
    </div>
  );
}

/**
 * Tier 3 — blocking overlay, only for what the candidate just did and can immediately fix.
 * Focus moves to the primary button and Tab is trapped; deliberately NO Escape handler.
 */
export function BlockingOverlay({ p }: { p: Proctoring }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!p.overlay) return;
    primaryRef.current?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button")];
      if (focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!dialogRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [p.overlay, p.fullscreenDenied]);

  if (!p.overlay) return null;
  const tab = p.overlay === "tab";
  return (
    <div className="blocking-overlay">
      <div className="blocking-card" role="alertdialog" aria-modal="true" aria-labelledby="ov-title" aria-describedby="ov-body" ref={dialogRef}>
        <span className="pill err">{p.strikeCount} recorded</span>
        <h2 id="ov-title">{tab ? "Browser Navigation Detected" : "Fullscreen Mode Required"}</h2>
        <p id="ov-body">
          {tab
            ? "Navigating away from this assessment window is recorded as a violation. Please stay on this tab for the rest of the assessment."
            : "This assessment must be conducted in fullscreen mode to maintain assessment integrity."}
        </p>
        {!tab && p.fullscreenDenied && (
          <p className="error-text">Your browser didn't grant fullscreen. Try again, or continue without it — that'll still be recorded.</p>
        )}
        <div className="blocking-actions">
          {tab ? (
            <button ref={primaryRef} className="btn" onClick={p.dismissTabOverlay}>Return to Assessment</button>
          ) : (
            <>
              <button ref={primaryRef} className="btn" onClick={() => void p.reenterFullscreen()}>Re-enter Fullscreen →</button>
              {p.fullscreenDenied && <button className="btn secondary" onClick={p.continueWithoutFullscreen}>Continue without fullscreen</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function DuplicateTabBlock() {
  return (
    <div className="duplicate-block" role="alertdialog" aria-modal="true" aria-labelledby="dup-title">
      <div className="blocking-card">
        <h2 id="dup-title">Already Open Elsewhere</h2>
        <p>This interview is already open in another tab or window. Please continue there — working in two tabs at once can cause answers to be lost. You can close this tab.</p>
      </div>
    </div>
  );
}
