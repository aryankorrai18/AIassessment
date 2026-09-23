import fs from "node:fs";
import path from "node:path";
import { cert, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { env } from "./env";
import { logger } from "../lib/logger";

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, "../../serviceAccountKey.json");

function init(): { app: App; mode: string } {
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    // A service account key forces real-cloud Firestore, even if the emulator env var is set.
    delete process.env.FIRESTORE_EMULATOR_HOST;
    const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));
    return { app: initializeApp({ credential: cert(serviceAccount) }), mode: "cloud" };
  }
  if (!process.env.FIRESTORE_EMULATOR_HOST) process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  return {
    app: initializeApp({ projectId: env.firebaseProjectId ?? "gapvise-dev" }),
    mode: `emulator (${process.env.FIRESTORE_EMULATOR_HOST})`,
  };
}

const { app, mode } = init();

export const firestoreMode = mode;
export const db: Firestore = env.firestoreDatabaseId ? getFirestore(app, env.firestoreDatabaseId) : getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

logger.info({ mode, databaseId: env.firestoreDatabaseId ?? "(default)" }, "Firestore initialized");
