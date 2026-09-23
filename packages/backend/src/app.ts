// Must be imported before any router is registered: a rejected async handler is
// then caught by the global error middleware instead of crashing the process.
import "express-async-errors";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { errorHandler } from "./middleware/errorHandler";
import { requireAdmin } from "./middleware/requireAdmin";
import { requireCandidate } from "./middleware/requireCandidate";
import adminAuthRouter from "./routes/admin/auth";
import candidatesRouter from "./routes/admin/candidates";
import jdMasterRouter from "./routes/admin/jdMaster";
import { apiUsageRouter, auditLogRouter, liveMonitorRouter, scheduleSweepRouter, settingsRouter } from "./routes/admin/misc";
import questionBankRouter from "./routes/admin/questionBank";
import resultsRouter from "./routes/admin/results";
import scheduleRouter from "./routes/admin/schedule";
import healthRouter from "./routes/health";
import candidateAuthRouter from "./routes/interview/auth";
import sessionRouter from "./routes/interview/session";
import violationRouter from "./routes/interview/violation";

export function createApp() {
  const app = express();
  // Behind Firebase Hosting / Cloud Run (and the Vite dev proxy) — trust the first hop for req.ip.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  // One line per request: method, url, status, duration.
  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/api/interview/session/heartbeat" },
    serializers: { req: (req) => ({ method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
    customSuccessMessage: (req, res, responseTime) =>
      `${req.method} ${(req as express.Request).originalUrl ?? req.url} ${res.statusCode} ${Math.round(responseTime)}ms`,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.use("/health", healthRouter);

  app.use("/api/admin/auth", adminAuthRouter);
  app.use("/api/admin/jd-master", requireAdmin, jdMasterRouter);
  app.use("/api/admin/candidates", requireAdmin, candidatesRouter);
  app.use("/api/admin/schedule", requireAdmin, scheduleSweepRouter, scheduleRouter);
  app.use("/api/admin/question-bank", requireAdmin, questionBankRouter);
  app.use("/api/admin/live-monitor", requireAdmin, liveMonitorRouter);
  app.use("/api/admin/results", requireAdmin, resultsRouter);
  app.use("/api/admin/api-usage", requireAdmin, apiUsageRouter);
  app.use("/api/admin/audit-log", requireAdmin, auditLogRouter);
  app.use("/api/admin/settings", requireAdmin, settingsRouter);

  app.use("/api/interview/auth", candidateAuthRouter);
  app.use("/api/interview/session", requireCandidate, sessionRouter);
  app.use("/api/interview/violation", requireCandidate, violationRouter);

  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use(errorHandler);
  return app;
}
