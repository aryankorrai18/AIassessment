import { useEffect } from "react";
import { IconCheck, IconClock } from "../components/Icons";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { clearAllDrafts, useCandidate } from "../lib/context";

/** No score, category or feedback is ever shown to the candidate. */
export default function End() {
  const { interview, timeExpired, reset } = useCandidate();
  const navigate = useNavigate();

  useEffect(() => {
    clearAllDrafts();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const answers = interview?.answers.length ?? 0;
  const sections = interview?.plan.length ?? 0;

  const done = async () => {
    try {
      await api("/auth/logout", {});
    } catch {
      // errors swallowed
    }
    reset();
    navigate("/interview/login", { replace: true });
  };

  return (
    <div className="end">
      <div className={`end-mark${timeExpired ? " expired" : ""}`} aria-hidden="true">
        {timeExpired ? <IconClock size={30} /> : <IconCheck size={30} />}
      </div>
      <h1 className="page-title">{timeExpired ? "Time's up" : "Assessment complete"}</h1>
      <p className="page-lede" style={{ marginTop: 0 }}>
        {timeExpired
          ? "Your interview's time limit was reached, so it was submitted automatically with the answers you'd given so far."
          : "Thanks for your time. Your responses have been submitted and will be reviewed by the hiring team."}
      </p>
      <div className="end-stats">
        <div><b>{answers}</b><span>{answers === 1 ? "answer" : "answers"} recorded</span></div>
        <div><b>{sections}</b><span>{sections === 1 ? "section" : "sections"}</span></div>
      </div>
      <p className="hint">The hiring team will be in touch about next steps. You don't need to do anything else.</p>
      <button className="btn large" onClick={() => void done()}>Done</button>
    </div>
  );
}
