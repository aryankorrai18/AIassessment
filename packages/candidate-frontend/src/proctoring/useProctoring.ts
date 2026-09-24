import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { FaceLandmarker, NormalizedLandmark, ObjectDetector } from "@mediapipe/tasks-vision";
import { reportViolation } from "../lib/api";

// ---- Tuning (PRD §6.6) ----
const FACE_INTERVAL_MS = 500;
const OBJECT_INTERVAL_MS = 2500;
const CALIBRATION_MS = 2000;
const GAZE_SUSTAIN_MS = 3000;
const MULTI_FACE_SUSTAIN_MS = 2000;
const DEBOUNCE_MS = 15_000;
const OBJECT_MIN_SCORE = 0.6;
const PROHIBITED = ["cell phone", "book", "laptop", "tv", "remote"];
export const OBJECT_ALERT_MS = 5000;
const SNAP_W = 320;
const SNAP_H = 240;
// Head-pose deviation from the calibrated baseline that counts as "looking away".
const GAZE_H_TOLERANCE = 0.18;
const GAZE_V_TOLERANCE = 0.15;

/** These increment the candidate-visible strike counter. */
const VISIBLE_TYPES = new Set(["TAB_SWITCH", "COPY_PASTE", "FULLSCREEN_EXIT"]);

export type FaceState = "initializing" | "ok" | "none" | "multiple";
export type Overlay = null | "tab" | "fullscreen";

export interface Proctoring {
  cameraError: string | null;
  faceState: FaceState;
  objectAlert: string | null;
  strikeCount: number;
  overlay: Overlay;
  fullscreenDenied: boolean;
  dismissTabOverlay: () => void;
  reenterFullscreen: () => Promise<void>;
  continueWithoutFullscreen: () => void;
}

/** Horizontal/vertical position of the nose within the face — a cheap, robust head-pose proxy. */
function headPose(lm: NormalizedLandmark[]) {
  const nose = lm[1], left = lm[33], right = lm[263], top = lm[10], chin = lm[152];
  const h = (nose.x - left.x) / (right.x - left.x || 1e-6);
  const v = (nose.y - top.y) / (chin.y - top.y || 1e-6);
  return { h, v };
}

async function createDetectors(): Promise<{ face: FaceLandmarker; objects: ObjectDetector }> {
  const vision = await import("@mediapipe/tasks-vision");
  // Self-hosted runtime + models: no third-party CDN, which restrictive networks often block.
  const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const make = async (delegate: "GPU" | "CPU") => Promise.all([
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/mediapipe/models/face_landmarker.task", delegate },
      runningMode: "VIDEO",
      numFaces: 3,
    }),
    vision.ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "/mediapipe/models/efficientdet_lite0.tflite", delegate },
      runningMode: "IMAGE",
      scoreThreshold: OBJECT_MIN_SCORE,
      categoryAllowlist: PROHIBITED,
      maxResults: 5,
    }),
  ]);
  let face: FaceLandmarker, objects: ObjectDetector;
  try {
    [face, objects] = await make("GPU");
  } catch {
    [face, objects] = await make("CPU");
  }
  return { face, objects };
}

/**
 * Entirely client-side. No video is ever uploaded — only discrete violation events, the
 * object detector attaching one downscaled still. Never auto-terminates the interview.
 */
export function useProctoring(active: boolean, videoRef: RefObject<HTMLVideoElement | null>): Proctoring {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [faceState, setFaceState] = useState<FaceState>("initializing");
  const [objectAlert, setObjectAlert] = useState<string | null>(null);
  const [strikeCount, setStrikeCount] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [fullscreenDenied, setFullscreenDenied] = useState(false);
  const lastFired = useRef(new Map<string, number>());

  /** Per-key 15s debounce, then report. */
  const fire = useCallback((type: string, detail: Record<string, unknown> = {}, snapshot: string | null = null, key = type) => {
    const now = Date.now();
    if (now - (lastFired.current.get(key) ?? 0) < DEBOUNCE_MS) return false;
    lastFired.current.set(key, now);
    reportViolation(type, detail, snapshot);
    return true;
  }, []);

  const strike = useCallback((type: string, detail: Record<string, unknown> = {}) => {
    reportViolation(type, detail);
    if (VISIBLE_TYPES.has(type)) setStrikeCount((n) => n + 1);
  }, []);

  // ---------- Camera + ML loops ----------
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let faceTimer: number | undefined;
    let objectTimer: number | undefined;
    let alertTimer: number | undefined;
    let detectors: { face: FaceLandmarker; objects: ObjectDetector } | null = null;

    (async () => {
      try {
        // ONE getUserMedia stream, shared by both loops and the self-view.
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        detectors = await createDetectors();
        if (cancelled) return;
      } catch (err) {
        if (!cancelled) setCameraError(err instanceof Error ? err.message : String(err));
        return;
      }

      const video = videoRef.current!;
      const canvas = document.createElement("canvas");
      canvas.width = SNAP_W;
      canvas.height = SNAP_H;
      const ctx = canvas.getContext("2d")!;

      const calibrationEnd = Date.now() + CALIBRATION_MS;
      const baseline: { h: number; v: number }[] = [];
      let multiSince: number | null = null;
      let gazeSince: number | null = null;

      faceTimer = window.setInterval(() => {
        if (video.readyState < 2 || !detectors) return;
        let faces: NormalizedLandmark[][];
        try {
          faces = detectors.face.detectForVideo(video, performance.now()).faceLandmarks;
        } catch {
          return;
        }
        // The live banner tracks the real instantaneous state, not the debounced violation.
        setFaceState(faces.length === 0 ? "none" : faces.length > 1 ? "multiple" : "ok");
        const now = Date.now();

        if (now < calibrationEnd) {
          if (faces.length === 1) baseline.push(headPose(faces[0]));
          return;
        }

        if (faces.length === 0) fire("NO_FACE"); // on the sample

        if (faces.length > 1) {
          multiSince ??= now;
          if (now - multiSince > MULTI_FACE_SUSTAIN_MS) fire("MULTIPLE_FACES", { faces: faces.length });
        } else {
          multiSince = null;
        }

        if (faces.length === 1) {
          const { h, v } = headPose(faces[0]);
          const h0 = baseline.length ? baseline.reduce((s, b) => s + b.h, 0) / baseline.length : 0.5;
          const v0 = baseline.length ? baseline.reduce((s, b) => s + b.v, 0) / baseline.length : 0.5;
          const away = Math.abs(h - h0) > GAZE_H_TOLERANCE || Math.abs(v - v0) > GAZE_V_TOLERANCE;
          if (away) {
            gazeSince ??= now;
            if (now - gazeSince > GAZE_SUSTAIN_MS) fire("GAZE_AWAY", { h: Number(h.toFixed(2)), v: Number(v.toFixed(2)) });
          } else {
            gazeSince = null;
          }
        } else {
          gazeSince = null;
        }
      }, FACE_INTERVAL_MS);

      objectTimer = window.setInterval(() => {
        if (video.readyState < 2 || !detectors) return;
        try {
          ctx.drawImage(video, 0, 0, SNAP_W, SNAP_H); // downscaled frame
          const found = detectors.objects.detect(canvas).detections
            .map((d) => d.categories[0])
            .filter((c) => c && c.score >= OBJECT_MIN_SCORE && PROHIBITED.includes(c.categoryName));
          for (const c of found) {
            const snapshot = canvas.toDataURL("image/jpeg", 0.6);
            if (fire("PROHIBITED_OBJECT", { object: c.categoryName, score: Number(c.score.toFixed(2)) }, snapshot, `object:${c.categoryName}`)) {
              // Point-in-time detection with no "still there" signal: show for a fixed window.
              setObjectAlert(c.categoryName);
              window.clearTimeout(alertTimer);
              alertTimer = window.setTimeout(() => setObjectAlert(null), OBJECT_ALERT_MS);
            }
          }
        } catch {
          // a dropped frame is not an error
        }
      }, OBJECT_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      window.clearInterval(faceTimer);
      window.clearInterval(objectTimer);
      window.clearTimeout(alertTimer);
      stream?.getTracks().forEach((t) => t.stop());
      detectors?.face.close();
      detectors?.objects.close();
    };
  }, [active, videoRef, fire]);

  // ---------- Browser signals: started unconditionally, so they work even if the camera fails ----------
  useEffect(() => {
    if (!active) return;
    let tabPending = false;
    let lastTabAt = 0;
    let blurTimer: number | undefined;
    let wasFullscreen = !!document.fullscreenElement;

    const recordTabSwitch = (how: string) => {
      const now = Date.now();
      tabPending = true;
      if (now - lastTabAt < 3000) return; // a blur and a hide for the same switch count once
      lastTabAt = now;
      strike("TAB_SWITCH", { how });
    };
    // Nothing can render while the tab is hidden, so the overlay fires on return.
    const showPending = () => {
      if (tabPending && document.visibilityState === "visible") {
        tabPending = false;
        setOverlay((o) => o ?? "tab");
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") recordTabSwitch("tab-hidden");
      else showPending();
    };
    const onBlur = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => {
        if (!document.hasFocus()) recordTabSwitch("window-blur");
      }, 1500);
    };
    const onFocus = () => {
      window.clearTimeout(blurTimer);
      showPending();
    };
    const onClipboard = (e: ClipboardEvent) => {
      e.preventDefault();
      strike("COPY_PASTE", { event: e.type });
    };
    const onFullscreen = () => {
      if (document.fullscreenElement) {
        wasFullscreen = true;
        return;
      }
      if (wasFullscreen) {
        wasFullscreen = false;
        strike("FULLSCREEN_EXIT");
        setFullscreenDenied(false);
        setOverlay("fullscreen"); // fires immediately
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("copy", onClipboard, true);
    document.addEventListener("cut", onClipboard, true);
    document.addEventListener("paste", onClipboard, true);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.clearTimeout(blurTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("copy", onClipboard, true);
      document.removeEventListener("cut", onClipboard, true);
      document.removeEventListener("paste", onClipboard, true);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [active, strike]);

  const reenterFullscreen = useCallback(async () => {
    const attempt = async () => {
      await document.documentElement.requestFullscreen();
      return !!document.fullscreenElement;
    };
    let ok = false;
    try {
      ok = await attempt();
    } catch {
      // Some browsers reject a request made too soon after an Esc-triggered exit: retry once.
      await new Promise((r) => setTimeout(r, 350));
      try {
        ok = await attempt();
      } catch {
        ok = false;
      }
    }
    // Auto-dismisses ONLY on real success; otherwise it stays up with an escape hatch.
    if (ok) {
      setOverlay(null);
      setFullscreenDenied(false);
    } else {
      setFullscreenDenied(true);
    }
  }, []);

  return {
    cameraError,
    faceState,
    objectAlert,
    strikeCount,
    overlay,
    fullscreenDenied,
    dismissTabOverlay: () => setOverlay(null),
    reenterFullscreen,
    continueWithoutFullscreen: () => {
      setOverlay(null);
      setFullscreenDenied(false);
    },
  };
}

/**
 * Hard-blocks a second tab/window of the same interview (scoped by the candidate's email — the frontend never
 * has the interviewId). A UX guard, not an integrity signal: no violation is logged.
 */
export function useDuplicateTabGuard(email: string | undefined): boolean {
  const [duplicate, setDuplicate] = useState(false);
  useEffect(() => {
    if (!email || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`gapvise-interview:${email}`);
    const me = { id: Math.random().toString(36).slice(2), openedAt: Date.now() };
    channel.onmessage = (e: MessageEvent<{ type: string; id: string; openedAt: number }>) => {
      const msg = e.data;
      if (msg.id === me.id) return;
      // An older tab answers a newcomer's hello; the newcomer is the duplicate.
      if (msg.type === "hello" && msg.openedAt > me.openedAt) channel.postMessage({ type: "present", ...me });
      if (msg.type === "present" && msg.openedAt < me.openedAt) setDuplicate(true);
    };
    channel.postMessage({ type: "hello", ...me });
    return () => channel.close();
  }, [email]);
  return duplicate;
}
