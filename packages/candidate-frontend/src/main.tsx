import { lazy, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary, RequireActiveInterview, RequireFinishedInterview, RequireProfile, Shell } from "./components/Shell";
import { CandidateProvider } from "./lib/context";
import "./styles/index.css";
import "./styles/cand-common.css";

// All four pages lazy-loaded, so MediaPipe and the editor only load when needed.
const Login = lazy(() => import("./pages/Login"));
const Instructions = lazy(() => import("./pages/Instructions"));
const Interview = lazy(() => import("./pages/Interview"));
const End = lazy(() => import("./pages/End"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/interview/login" replace />} />
        <Route path="/interview" element={<ErrorBoundary><CandidateProvider><Shell /></CandidateProvider></ErrorBoundary>}>
          <Route index element={<Navigate to="login" replace />} />
          <Route path="login" element={<Login />} />
          <Route path="instructions" element={<RequireProfile><Instructions /></RequireProfile>} />
          <Route path="session" element={<RequireActiveInterview><Interview /></RequireActiveInterview>} />
          <Route path="end" element={<RequireFinishedInterview><End /></RequireFinishedInterview>} />
        </Route>
        <Route path="*" element={<Navigate to="/interview/login" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
