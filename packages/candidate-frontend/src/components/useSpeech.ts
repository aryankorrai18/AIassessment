import { useCallback, useEffect, useRef, useState } from "react";
import { reportViolation } from "../lib/api";

export const SILENCE_TIMEOUT_MS = 45_000;

// Minimal typing for the Web Speech API (not in lib.dom for every TS target).
interface SpeechResultList { length: number; [i: number]: { 0: { transcript: string } } }
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined =
  (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export type SpeechProblem = null | "unsupported" | "denied";

/**
 * Voice answers via the browser's own speech recognition. Each transcript update replaces the
 * answer text (continuing from whatever was there when recording started). Both degraded paths
 * are non-blocking — the candidate can always type.
 */
export function useSpeech(onTranscript: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<SpeechProblem>(Ctor ? null : "unsupported");
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const committedRef = useRef("");
  const lastRef = useRef("");
  const heardRef = useRef(false);
  const silenceTimer = useRef<number | undefined>(undefined);
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  const stop = useCallback(() => {
    wantRef.current = false;
    window.clearTimeout(silenceTimer.current);
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  }, []);

  const start = useCallback((currentText: string) => {
    if (!Ctor) return setProblem("unsupported");
    stop();
    committedRef.current = currentText.trim();
    lastRef.current = committedRef.current;
    heardRef.current = false;
    wantRef.current = true;

    const launch = () => {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        if (text.trim()) heardRef.current = true;
        lastRef.current = [committedRef.current, text.trim()].filter(Boolean).join(" ");
        cbRef.current(lastRef.current);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
          setProblem("denied");
          reportViolation("MIC_PERMISSION_DENIED", { error: e.error });
          stop();
        }
      };
      // Browsers end continuous recognition on their own; keep going until the candidate stops.
      rec.onend = () => {
        if (!wantRef.current) return;
        committedRef.current = lastRef.current;
        launch();
      };
      recRef.current = rec;
      try {
        rec.start();
      } catch {
        // already started
      }
    };
    launch();
    setRecording(true);

    // ONE soft signal per recording session if nothing at all is heard; never blocks progress.
    silenceTimer.current = window.setTimeout(() => {
      if (wantRef.current && !heardRef.current) reportViolation("MIC_SILENCE_TIMEOUT", { afterMs: SILENCE_TIMEOUT_MS });
    }, SILENCE_TIMEOUT_MS);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { recording, problem, start, stop };
}
