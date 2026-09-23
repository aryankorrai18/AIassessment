import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RequireAdmin, RequireMasterAdmin, Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import { AuthProvider } from "./lib/auth";
import LoginPage from "./pages/Login";
import "./styles/index.css";
import "./styles/admin-common.css";

// Every page except login is lazy-loaded, so a heavy per-page dependency (exceljs) stays out of the others.
const Overview = lazy(() => import("./pages/Overview"));
const Candidates = lazy(() => import("./pages/Candidates"));
const JdMaster = lazy(() => import("./pages/JdMaster"));
const QuestionBank = lazy(() => import("./pages/QuestionBank"));
const Schedule = lazy(() => import("./pages/Schedule"));
const LiveMonitor = lazy(() => import("./pages/LiveMonitor"));
const Results = lazy(() => import("./pages/Results"));
const ApiUsage = lazy(() => import("./pages/ApiUsage"));
const Profile = lazy(() => import("./pages/Profile"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Settings = lazy(() => import("./pages/Settings"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Navigate to="/admin/overview" replace />} />
              <Route path="/admin/login" element={<LoginPage />} />
              <Route path="/admin/forgot-password" element={<Suspense fallback={null}><ForgotPassword /></Suspense>} />
              <Route path="/admin/reset-password" element={<Suspense fallback={null}><ResetPassword /></Suspense>} />
              <Route path="/admin" element={<RequireAdmin><Shell /></RequireAdmin>}>
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<Overview />} />
                <Route path="candidates" element={<Candidates />} />
                <Route path="jd-master" element={<JdMaster />} />
                <Route path="question-bank" element={<QuestionBank />} />
                <Route path="schedule" element={<Schedule />} />
                <Route path="live-monitor" element={<LiveMonitor />} />
                <Route path="results" element={<Results />} />
                <Route path="api-usage" element={<ApiUsage />} />
                <Route path="profile" element={<Profile />} />
                <Route path="users" element={<RequireMasterAdmin><AdminUsers /></RequireMasterAdmin>} />
                <Route path="audit-log" element={<RequireMasterAdmin><AuditLog /></RequireMasterAdmin>} />
                <Route path="settings" element={<RequireMasterAdmin><Settings /></RequireMasterAdmin>} />
              </Route>
              <Route path="*" element={<Navigate to="/admin/overview" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
