import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env"), quiet: true });

if (!process.env.JWT_SECRET) {
  // Hard crash, not a warning: a running server that would silently accept any
  // signature is worse than one that refuses to start.
  throw new Error("JWT_SECRET env var is not set. Refusing to start — set it in packages/backend/.env.");
}

function parseOrigins(): string[] {
  const list = process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN;
  if (!list) return ["http://localhost:5173", "http://localhost:5174"];
  return list.split(",").map((o) => o.trim()).filter(Boolean);
}

export const env = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET,
  isProduction: process.env.NODE_ENV === "production",
  corsOrigins: parseOrigins(),
  corsOrigin: process.env.CORS_ORIGIN ?? null,
  // Where the admin dashboard is served; used to build password-reset links.
  adminAppUrl: (process.env.ADMIN_APP_URL || "http://localhost:5173").replace(/\/+$/, ""),
  geminiApiKey: process.env.GEMINI_API_KEY || null,
  logLevel: process.env.LOG_LEVEL || "info",
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || undefined,
  firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || undefined,
  noShowReminderIntervalMs: Number(process.env.NO_SHOW_REMINDER_INTERVAL_MS) || 24 * 60 * 60 * 1000,
  emailjs: {
    serviceId: process.env.EMAILJS_SERVICE_ID || null,
    templateId: process.env.EMAILJS_TEMPLATE_ID || null,
    publicKey: process.env.EMAILJS_PUBLIC_KEY || null,
    privateKey: process.env.EMAILJS_PRIVATE_KEY || null,
  },
};
