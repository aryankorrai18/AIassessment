import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";

// Logs the real error server-side; never sends stack traces or internals.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) {
    logger.error({ err, path: req.path }, "Error after response headers were sent");
    return;
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // Malformed JSON body from express.json()
  if (typeof err === "object" && err !== null && (err as { type?: string }).type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid request." });
  }
  logger.error({ err, method: req.method, path: req.path }, "Unhandled request error");
  res.status(500).json({ error: "Something went wrong handling that request. Please try again." });
}
