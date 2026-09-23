import { useEffect } from "react";
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
    <div className="card end-card">
      <div className="check-badge" aria-hidden="true">✓</div>
      <h1 style={{ fontSize: 26 }}>{timeExpired ? "Time's up" : "Assessment Complete"}</h1>
      <p className="muted" style={{ margin: 0 }}>
        {timeExpired
          ? "Your interview's time limit was reached, so it was submitted automatically with the answers you'd given so far."
          : "Thanks for your time. Your responses have been submitted and will be reviewed by the hiring team."}
      </p>
      <p className="hint" style={{ margin: 0 }}>{answers} answer(s) recorded across {sections} section(s).</p>
      <button className="btn" onClick={() => void done()}>Done</button>
    </div>
  );
}
