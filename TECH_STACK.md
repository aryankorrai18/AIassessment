# GapVise AI — Tech Stack

> Companion to **PRD.md** (what to build) and **PRODUCTION_FIXES.md**
> (hardening backlog). This document specifies exactly what to build the
> product with, and — where the original project's choices were driven by a
> real constraint rather than taste — *why*, so a rebuild doesn't "improve"
> away a deliberate decision.

## 1. Monorepo layout

npm workspaces, three packages, no shared library package today (the two
frontends were split apart from one app and each currently vendors its own
copies of small shared concepns like icon components and CSS):

```
/
├── package.json              # workspaces: ["packages/*"]
├── firebase.json             # Firebase Hosting config, both sites
├── .firebaserc                # Hosting project/site targets
├── packages/
│   ├── backend/               # Node/Express/TypeScript API
│   ├── admin-frontend/        # Vite/React SPA — staff dashboard
│   └── candidate-frontend/    # Vite/React SPA — interview experience
├── camera-mic-test/           # standalone permission-check utility page
└── mock-data/                 # sample/seed data for local dev
```

## 2. Backend stack

**Runtime**: Node.js 20+, TypeScript, CommonJS output (`tsc` build → `node
dist/index.js`). Dev loop uses `tsx watch`.

**Framework & middleware**:
- `express` — HTTP framework.
- `express-async-errors` — imported before any router is registered, so a
  rejected async handler is caught by the global error middleware instead of
  crashing the process. This exists because of a real production incident: a
  hung Firestore query once took the whole process down via an unhandled
  rejection. Keep this import order.
- `helmet` — standard security headers.
- `cors` — origin allowlist from `CORS_ORIGINS`/`CORS_ORIGIN` (see §5),
  `credentials: true` (cookies must cross the admin/candidate frontend →
  backend origin boundary).
- `cookie-parser` — reads the httpOnly session cookies.
- `express-rate-limit` — brute-force protection on both login routes
  (in-memory `MemoryStore` — see PRODUCTION_FIXES.md for why this needs
  `min-instances=1` and what breaks otherwise).
- `pino` + `pino-http` — structured JSON logging in production, pretty-print
  in dev; one line per request with method/status/duration.
- `zod` — request body validation on every mutating route.
- `node-cron` — in-process scheduling for the three background sweeps (see
  PRD.md §3.9 and PRODUCTION_FIXES.md for the multi-instance caveat).

**Auth & crypto**:
- `jsonwebtoken` — access + refresh token signing/verification.
- `bcryptjs` — password and access-key hashing (pure JS, no native
  compilation step — consistent with this project's general stance of
  avoiding anything requiring a native/binary install, since the target
  network's proxy has repeatedly blocked such downloads).
- Node's built-in `crypto` — SHA-256 + `timingSafeEqual` for refresh-token
  hash comparison (a lighter-weight primitive than bcrypt is appropriate here
  since refresh tokens are already high-entropy random values, not
  human-chosen secrets), and `randomInt` for CSPRNG-backed access-key
  generation.

**Document/file processing**:
- `mammoth` — `.docx` → plain text for JD uploads.
- `pdfjs-dist` — `.pdf` → plain text for JD uploads. Deliberately the legacy
  pure-JS build, not `pdf-parse`, after a real tokenizer bug was hit with the
  alternative — and specifically *not* anything Puppeteer/Chromium-based,
  since a headless-Chromium download is exactly the kind of native-binary
  fetch this network's proxy tends to block.
- `pdfkit` — PDF **generation** for the results report. Chosen over an
  HTML-to-PDF-via-headless-browser approach for the same native-binary/proxy
  reason above. Generates on demand, streamed to the response — never
  persisted to disk or object storage.
- `multer` — file upload handling, **memory storage only** (`multer.memoryStorage()`,
  10MB cap) — JD files are parsed and discarded, never written to disk.

**Data**:
- `firebase-admin` — the *only* database client. No SQL, no ORM, no Redis.
  Firestore Admin SDK bypasses security rules entirely (rules exist purely as
  defense-in-depth against a hypothetical direct client, since the frontends
  never talk to Firestore directly — only through this backend).

**AI**:
- **No Gemini SDK dependency** — `lib/gemini.ts` calls the Gemini REST API
  directly via `fetch`, deliberately, again to avoid a package with a
  native/binary install step. Two models are pinned explicitly (not aliased
  to `-latest`, to avoid an unannounced tier/pricing change silently
  affecting cost): a primary cost/tier-optimized model and a fallback model
  tried only after the primary exhausts its own retries on a retryable error
  (429/500/502/503/504 — treated as transient demand spikes) — a genuinely
  different model, so a different capacity pool, not just re-hitting the
  same overloaded endpoint. Non-retryable errors (400/401/403/404) fail
  immediately, since they'd fail identically on any retry. The API key is
  resolved from Firestore first (admin-rotatable without a redeploy), falling
  back to the `GEMINI_API_KEY` env var, cached in-memory per backend
  instance for 5 minutes.

**Email**:
- No SMTP library. `services/email.ts` calls EmailJS's HTTPS REST API
  directly, specifically because this deployment's network proxy blocks raw
  SMTP sockets outright — this is a network-environment constraint, not a
  preference, and should not be "simplified" to nodemailer/SMTP on a rebuild
  without first confirming the target network allows it.

## 3. Frontend stack

Both `admin-frontend` and `candidate-frontend` share the same toolchain,
built and deployed independently:

- **React 19**, **TypeScript**, **Vite 8** (dev server + build), **Vitejs's
  React plugin**.
- **react-router-dom v7** for client-side routing, one route tree per app,
  pages lazy-loaded (`React.lazy`) so a heavy per-page dependency (e.g.
  `exceljs` on one admin page) doesn't bloat every other page's bundle.
- **No UI component library, no CSS framework.** Hand-written CSS per app
  (`index.css`, a shared `*-common.css`, plus per-page stylesheets) and a
  small local set of icon/UI components. A rebuild should follow this same
  approach unless there's a new, explicit decision to adopt a library — don't
  default to pulling one in.
- **`oxlint`** for linting (both frontends).
- **`exceljs`** — admin-frontend only, for client-side Excel import
  (candidate bulk upload) and export (master results export). No backend
  Excel generation exists.

**candidate-frontend-specific**:
- **`@mediapipe/tasks-vision`** — face/gaze/object detection for proctoring,
  running entirely client-side against the browser's own camera stream (one
  `getUserMedia` call shared by both detection loops). The WASM runtime and
  model files are **self-hosted under `public/`, not loaded from a CDN**
  (`FilesetResolver.forVisionTasks("/mediapipe/wasm")`) — again a
  network-proxy constraint (the usual `cdn.jsdelivr.net` MediaPipe hosting is
  blocked by TLS inspection on this network), not a preference. A rebuild
  targeting a different network environment could reconsider this, but
  should not assume CDN-loading "just works" without checking.
- Camera/mic/fullscreen permission checks happen in a dedicated
  `Instructions` step before the interview session starts.

## 4. Data & infrastructure

- **Database**: Google Cloud Firestore (Native mode), no other datastore.
- **Backend hosting**: Google Cloud Run, region `asia-south1`, service name
  `gapvise-backend`. Reached from both frontends via Firebase Hosting
  rewrites (`/api/**` → the Cloud Run service), not called directly by the
  browser — so from the browser's perspective, the API is same-origin with
  each frontend's own hosting domain.
- **Frontend hosting**: Firebase Hosting, **multi-site** — one site per
  frontend app (`admin`, `candidate`), configured as separate `hosting`
  targets in `firebase.json` against a single Firebase project
  (`.firebaserc`). Long-lived immutable caching (`max-age=31536000`) on
  hashed static assets; the candidate site additionally sets
  `Cross-Origin-Embedder-Policy`/`Cross-Origin-Opener-Policy` on
  `.wasm`/`.tflite`/`.task` files (required for the MediaPipe WASM runtime).
  Both sites set `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`.
- **AI**: Gemini API (`generativelanguage.googleapis.com`), called directly
  over REST — no Vertex AI, no SDK. Billing is per-token, separate from core
  GCP infra billing, tracked in-app via the `apiUsageLog` collection.
- **Email**: EmailJS (third-party SaaS), REST API, not a GCP service.
- **No Cloud Storage bucket, no Redis, no message queue, no Vertex AI, no
  Cloud Functions** are part of this architecture. Don't introduce one on a
  rebuild without a new, explicit requirement driving it.

## 5. Full environment variable reference

| Variable | Purpose | Required? |
|---|---|---|
| `PORT` | Express listen port | No — defaults to `4000` |
| `JWT_SECRET` | Signs all admin + candidate access/refresh JWTs | **Yes — process hard-crashes at import time if unset.** This is intentional: a running server that would silently accept any signature is worse than refusing to start. |
| `CORS_ORIGIN` | Single-origin CORS fallback; also used to build the candidate-portal link embedded in emails | Recommended |
| `CORS_ORIGINS` | Comma-separated allowlist, supports serving admin+candidate frontends from different origins; falls back to `localhost:5173`/`5174` if neither this nor `CORS_ORIGIN` is set | No, but production should always set this explicitly rather than rely on the dev fallback |
| `GEMINI_API_KEY` | Fallback Gemini key, used only if no key has been set via Admin → Settings (Firestore) | Recommended for first boot; becomes optional once a key is set via the admin UI |
| `EMAILJS_SERVICE_ID` / `EMAILJS_TEMPLATE_ID` / `EMAILJS_PUBLIC_KEY` / `EMAILJS_PRIVATE_KEY` | EmailJS REST API credentials for transactional email (access-key delivery, reminders, no-show escalation). Template must define merge variables `to_email`, `subject`, `message_html`, `message_text`. | No — if unset, sends log to console instead of failing (see PRD.md §3.4) |
| `NODE_ENV` | Gates the `secure` cookie flag and pino's JSON-vs-pretty output | Should always be `"production"` in production — Cloud Run does not set this for you |
| `LOG_LEVEL` | pino log level override | No |
| `FIREBASE_PROJECT_ID` | GCP project ID, used when initializing Firebase Admin against the local emulator | No in real-cloud mode (the service account key implies the project); relevant for emulator-based local/dev setups |
| `FIRESTORE_DATABASE_ID` | Selects a named Firestore database within the project instead of `(default)` — e.g. a `staging` database | No |
| `FIRESTORE_EMULATOR_HOST` | Standard Firebase Admin SDK env var that switches Firestore to emulator mode | No — set only for local dev without a service account key |
| `NO_SHOW_REMINDER_INTERVAL_MS` | Overrides the no-show reminder ladder's step interval (default 24h) | No |

**File-based config**: `packages/backend/serviceAccountKey.json` — if
present, forces real-cloud Firestore auth as that service account; if
absent, the backend falls back to the local Firestore emulator. This file is
git-ignored and must never be committed. **How this file (or an equivalent
Application Default Credentials setup) is actually provisioned onto the
production Cloud Run instance is not something this document — or the
original project — has written down anywhere in version control.** Decide
and document this explicitly as part of a rebuild (see
PRODUCTION_FIXES.md, "no deployment manifest").

## 6. Local development setup

```bash
npm install --workspaces

# Backend
cp packages/backend/.env.example packages/backend/.env
# fill in JWT_SECRET at minimum; everything else has a dev-safe fallback

cd packages/backend && npm run dev     # Express on :4000, tsx watch
```

```bash
# Frontends, in separate terminals
cd packages/admin-frontend && npm run dev       # Vite dev server
cd packages/candidate-frontend && npm run dev   # Vite dev server
```

Without `packages/backend/serviceAccountKey.json`, the backend talks to the
Firestore **local emulator** instead of real Firestore — a fully offline
setup (`npm run emulator` inside `packages/backend` starts
`firebase emulators:start --only firestore`).

First run only, create the first admin account:
```bash
cd packages/backend && npm run seed:admin
# Prompts nothing. Default email master@virtusa.com (or whatever this
# rebuild's convention is). Password is randomly generated and printed
# ONCE — there is no way to recover it later, and no hardcoded default.
```

## 7. Deployment topology

**Known from repo config** (`.firebaserc`, `firebase.json`):
- One Firebase project, two Hosting sites (`admin`, `candidate` targets).
- Both sites rewrite `/api/**` to a Cloud Run service named
  `gapvise-backend` in region `asia-south1`.

**Explicitly undocumented in the source project — must be created fresh on
a rebuild, not assumed to exist:**
- No `Dockerfile` for the backend.
- No `cloudbuild.yaml` or any other CI/CD pipeline definition.
- No committed deploy script (the real deploy process almost certainly used
  `gcloud run deploy --source .` with manually-remembered flags — critically
  including `--min-instances=1 --max-instances=1`, since the in-memory rate
  limiter and the in-process `node-cron` sweeps both silently assume exactly
  one long-running instance; see PRODUCTION_FIXES.md).
- No documented secret-provisioning path for `serviceAccountKey.json` (or an
  ADC-based alternative) onto the Cloud Run instance.

A rebuild should treat "write the Dockerfile, the deploy pipeline, and the
instance-count/secret-provisioning decisions" as first-class deliverables,
not an afterthought — see PRODUCTION_FIXES.md's Critical section for the
specific risks this gap creates.
