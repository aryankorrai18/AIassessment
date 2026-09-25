# GapVise AI

AI-assisted technical skills assessment. A hiring team uploads a job description,
GapVise generates a calibrated question bank, candidates take a timed, proctored
interview in the browser, and every interview comes back as a scored, defensible
skill-gap report.

- **What the product does:** [`PRD.md`](PRD.md) — the build-grade spec (constants, API contracts, prompts).
- **How it's built:** [`TECH_STACK.md`](TECH_STACK.md) — stack, configuration, deployment constraints.
- **How we work on it:** [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, branches, pull requests.

## Repository layout

```
packages/
├── backend/             Node + Express + TypeScript API on Firestore (port 4000)
├── admin-frontend/      React + Vite dashboard for the hiring team (port 5173)
└── candidate-frontend/  React + Vite interview app with in-browser proctoring (port 5174)
```

npm workspaces; run every command below from the repository root.

## Quick start

You need **Node.js 20+** and, for real data, access to the team's Firebase project
(see [CONTRIBUTING.md → Secrets](CONTRIBUTING.md#2-get-your-secrets)).

```bash
npm install
npm run setup:mediapipe          # downloads the proctoring models (~50 MB, git-ignored)
cp packages/backend/.env.example packages/backend/.env   # then fill in JWT_SECRET and GEMINI_API_KEY
# put serviceAccountKey.json in packages/backend/ (or use the emulator, see CONTRIBUTING.md)
```

Then start the three apps, each in its own terminal:

```bash
npm run dev:backend      # API        → http://localhost:4000
npm run dev:admin        # Admin      → http://localhost:5173
npm run dev:candidate    # Candidates → http://localhost:5174
```

Both frontends proxy `/api` to the backend, so open the two URLs above directly.

**First admin account:** if your database has no admin yet, run `npm run seed:admin`
(it prints a one-time password). On the shared team database, ask the workspace
owner to create an account for you from **Admin Users** instead.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev:backend` / `dev:admin` / `dev:candidate` | Start one app in watch mode |
| `npm test` | Backend unit tests (Vitest) |
| `npm run check` | Everything a pull request must pass: typecheck, tests, lint and production builds |
| `npm run seed:admin` | Create the first admin account (password printed once) |
| `npm run setup:mediapipe` | Download the MediaPipe runtime + models for proctoring |
| `npm run emulator -w packages/backend` | Local Firestore emulator (needs Java) |

## Trying the whole flow locally

1. **Admin → JD Master:** paste or upload a job description, extract, save. Question
   generation runs in the background (about a minute).
2. **Admin → Candidates:** add a candidate whose *JD Reference* is the JD's exact title.
3. **Admin → Interview Schedule:** schedule them — the one-time access key is shown on screen
   (and emailed if EmailJS is configured; otherwise it's printed in the backend console).
4. **Candidate app:** sign in with the candidate's email and that key, then take the interview
   (Chrome or Edge; allow camera and microphone).
5. **Admin → Results:** the scored report and PDF appear a minute or two after the interview ends.
