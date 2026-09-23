# GapVise AI — Tech Stack

> Companion to **PRD.md** (what the product does). This document specifies what
> it's built with and — where a choice follows from a real constraint rather
> than taste — *why*, so nobody "improves" away a deliberate decision.

## Design principle: runs on locked-down networks

GapVise AI is sold to enterprises, and both its admins and its candidates often
sit behind corporate networks that block raw SMTP, third-party CDNs, TLS-
inspected downloads and native-binary installs. Several choices below exist for
that reason and should not be "simplified" without confirming the network the
deployment will serve:

- **No native/binary dependencies** anywhere in the build (pure-JS bcrypt, no
  headless Chromium, no Gemini SDK).
- **Email over HTTPS** (EmailJS REST), never raw SMTP.
- **MediaPipe self-hosted** by the candidate app, never loaded from a CDN.

## 1. Monorepo layout

npm workspaces, three packages, no shared library package (each frontend
carries its own small copies of shared concepts such as icons and CSS):

```
/
├── package.json              # workspaces: ["packages/*"]
├── PRD.md · TECH_STACK.md
└── packages/
    ├── backend/               # Node/Express/TypeScript API
    ├── admin-frontend/        # Vite/React SPA — hiring-team dashboard
    └── candidate-frontend/    # Vite/React SPA — interview experience
```

## 2. Backend stack

**Runtime**: Node.js 20+, TypeScript compiled to CommonJS (`tsc` build →
`node dist/index.js`). Dev loop uses `tsx watch`.

**Framework & middleware**:
- `express` — HTTP framework.
- `express-async-errors` — imported before any router is registered, so a
  rejected async handler reaches the global error middleware instead of
  crashing the process (a hung datastore query must never take the whole API
  down). Keep this import order.
- `helmet` — standard security headers.
- `cors` — origin allowlist from `CORS_ORIGINS`/`CORS_ORIGIN` (§5),
  `credentials: true` (session cookies cross the frontend → backend boundary).
- `cookie-parser` — reads the httpOnly session cookies.
- `express-rate-limit` — brute-force protection on both login routes and the
  password-reset routes. Uses the in-memory store, which is why the backend
  must currently run as **exactly one instance** (§7).
- `pino` + `pino-http` — structured JSON logging in production, pretty-printed
  in dev; one line per request with method, URL, status and duration.
- `zod` — request validation on every mutating route.
- `node-cron` — in-process scheduling for the three background sweeps (PRD
  §6.9). Also a single-instance assumption.

**Auth & crypto**:
- `jsonwebtoken` — access and refresh token signing/verification.
- `bcryptjs` — password and access-key hashing (pure JS, no native build step).
- Node's built-in `crypto` — SHA-256 + `timingSafeEqual` for refresh-token and
  password-reset-token hashes (these are high-entropy random values, not
  human-chosen secrets, so a fast hash is appropriate), `randomInt` for
  CSPRNG access keys and `randomBytes` for reset tokens.

**Document/file processing**:
- `mammoth` — `.docx` → text for JD uploads.
- `pdfjs-dist` — `.pdf` → text for JD uploads, using the legacy pure-JS build
  (chosen over `pdf-parse`, whose tokenizer mishandled real JDs, and over any
  headless-browser approach).
- `pdfkit` — PDF **generation** for results reports, generated on demand and
  streamed to the response — never written to disk or object storage.
- `multer` — uploads, **memory storage only** (10 MB cap); JD files are parsed
  and discarded, never written to disk.

**Data**:
- `firebase-admin` — the *only* database client: Cloud Firestore (Native mode).
  No SQL, no ORM, no Redis. The Admin SDK bypasses security rules; the
  frontends never talk to Firestore directly, only through this API.

**AI**:
- **No Gemini SDK** — `lib/gemini.ts` calls the Gemini REST API with `fetch`.
  Two models are pinned explicitly (not a `-latest` alias for the primary, so
  an unannounced tier or pricing change can't silently affect cost): a primary
  cost-optimized model and a fallback tried only after the primary exhausts its
  retries on a transient error (429/500/502/503/504). Non-retryable errors
  (400/401/403/404) fail immediately. The key is resolved from Firestore first
  (rotatable from Admin → Settings without a redeploy), then the
  `GEMINI_API_KEY` env var, and cached in memory for 5 minutes.

**Email**:
- No SMTP library. `services/email.ts` calls EmailJS's HTTPS REST API. When
  EmailJS isn't configured, emails are written to the server log instead of
  failing the request — convenient in development, and it means access keys
  and reset links are still recoverable by an operator.

## 3. Frontend stack

Both SPAs share the same toolchain and are built and deployed independently:

- **React 19**, **TypeScript**, **Vite 8** with the React plugin.
- **react-router-dom v7**, one route tree per app, pages lazy-loaded with
  `React.lazy` so a heavy per-page dependency (e.g. `exceljs`) doesn't bloat
  every other page.
- **No UI component library or CSS framework.** Hand-written CSS per app
  (`index.css`, a shared `*-common.css`, per-page stylesheets) and a small local
  set of icon/UI components. Adopting a library should be an explicit decision.
- **`oxlint`** for linting.
- **`exceljs`** — admin app only, for client-side Excel import (bulk candidate
  upload) and export (access keys, master results). There is no backend Excel
  generation.

**candidate-frontend-specific**:
- **`@mediapipe/tasks-vision`** — face, gaze and object detection for
  proctoring, running entirely in the browser against one shared camera stream.
  The WASM runtime and model files are **self-hosted under
  `public/mediapipe/`** (`FilesetResolver.forVisionTasks("/mediapipe/wasm")`).
  They are git-ignored; recreate them with
  `npm run setup:mediapipe -w packages/candidate-frontend`.
- **Web Speech API** for voice answers (Chrome/Edge), with typed input as the
  always-available fallback.

## 4. Data & infrastructure

- **Database**: Google Cloud Firestore (Native mode), no other datastore.
- **Backend hosting (target)**: Google Cloud Run, reached from both frontends
  through Firebase Hosting rewrites (`/api/**` → the Cloud Run service), so the
  API is same-origin with each frontend from the browser's point of view.
- **Frontend hosting (target)**: Firebase Hosting, **multi-site** — one site per
  app (`admin`, `candidate`). Long-lived immutable caching on hashed assets;
  the candidate site also sets `Cross-Origin-Embedder-Policy` /
  `Cross-Origin-Opener-Policy` on `.wasm`/`.tflite`/`.task` files for the
  MediaPipe runtime. Both sites set `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: strict-origin-when-cross-origin`.
- **AI**: Gemini API over REST — no Vertex AI, no SDK. Token spend is tracked
  in-app in the `apiUsageLog` collection.
- **Email**: EmailJS (third-party SaaS) over REST.
- **Not part of the architecture**: Cloud Storage buckets, Redis, message
  queues, Vertex AI, Cloud Functions. Introduce one only with an explicit
  requirement (several appear on the PRD §15 roadmap).

## 5. Environment variables (`packages/backend/.env`)

| Variable | Purpose | Required? |
|---|---|---|
| `PORT` | Express listen port | No — defaults to `4000` |
| `JWT_SECRET` | Signs all admin + candidate access/refresh JWTs | **Yes — the server refuses to start without it.** A running server that would accept any signature is worse than one that won't start. |
| `CORS_ORIGIN` | Single-origin CORS fallback; also the base of the candidate-portal link in emails | Recommended |
| `CORS_ORIGINS` | Comma-separated allowlist (admin + candidate origins); falls back to `localhost:5173`/`5174` | Set explicitly in production |
| `ADMIN_APP_URL` | Admin dashboard URL, used to build password-reset links | Recommended; defaults to `http://localhost:5173` |
| `GEMINI_API_KEY` | Fallback Gemini key, used only when no key is set in Admin → Settings | Needed until a key is set in the admin UI |
| `EMAILJS_SERVICE_ID` / `EMAILJS_TEMPLATE_ID` / `EMAILJS_PUBLIC_KEY` / `EMAILJS_PRIVATE_KEY` | Transactional email (access keys, reminders, no-show escalations, password resets). The template must use the merge variables `to_email`, `subject`, `message_html`, `message_text`. | No — without them, emails are written to the server log |
| `NODE_ENV` | Gates the `secure` cookie flag and JSON-vs-pretty logs | Always `production` in production (Cloud Run doesn't set it) |
| `LOG_LEVEL` | pino log level override | No |
| `FIREBASE_PROJECT_ID` | Project ID when running against the local Firestore emulator | Emulator only |
| `FIRESTORE_DATABASE_ID` | Use a named Firestore database (e.g. `staging`) instead of `(default)` | No |
| `FIRESTORE_EMULATOR_HOST` | Standard Admin SDK switch to emulator mode | Emulator only |
| `NO_SHOW_REMINDER_INTERVAL_MS` | Step interval of the no-show reminder ladder (default 24h) | No |
| `SEED_ADMIN_EMAIL` | Email for the first admin created by `npm run seed:admin` | No — defaults to `admin@example.com` |

**Service account**: `packages/backend/serviceAccountKey.json` — if present,
the backend uses real Firestore as that service account; if absent, it falls
back to the local emulator. The file is git-ignored and must never be
committed. In production, prefer Application Default Credentials (the Cloud Run
service account) over shipping a key file.

## 6. Local development

```bash
npm install
npm run setup:mediapipe -w packages/candidate-frontend   # MediaPipe runtime + models, once

cp packages/backend/.env.example packages/backend/.env   # set JWT_SECRET and GEMINI_API_KEY at minimum
# add packages/backend/serviceAccountKey.json for real Firestore (or run the emulator)

npm run seed:admin -w packages/backend                    # first admin; password printed once

npm run dev -w packages/backend              # API on :4000
npm run dev -w packages/admin-frontend       # admin dashboard on :5173
npm run dev -w packages/candidate-frontend   # candidate app on :5174
```

Both Vite dev servers proxy `/api` to `localhost:4000`, so cookies are
same-origin in development, mirroring the production Hosting rewrite.

Without a service account key the backend talks to the Firestore **emulator**
(`npm run emulator` inside `packages/backend` starts it; needs Java).

**Tests**: `npm test -w packages/backend` runs the Vitest suite — scoring,
integrity, plan building, the interview state machine, tokens, and prompt
fidelity against PRD Appendix A.

## 7. Deployment

**Target topology**: one Firebase project, two Hosting sites (`admin`,
`candidate`), both rewriting `/api/**` to a Cloud Run service.

**Hard constraint today**: run the backend with **exactly one instance**
(`--min-instances=1 --max-instances=1`). The in-memory rate limiters and the
in-process `node-cron` sweeps both assume one long-lived process — more
instances would multiply sweeps and weaken rate limits; zero instances would
stop the sweeps. Lifting this (a shared rate-limit store and a distributed job
scheduler) is on the PRD §15 roadmap.

**Still to be written** before a production launch: the backend `Dockerfile`,
the `firebase.json` Hosting configuration, a CI/CD pipeline, and the
secret-provisioning setup (Secret Manager for `JWT_SECRET`, EmailJS and Gemini
keys; ADC instead of a key file).
