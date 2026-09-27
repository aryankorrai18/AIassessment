# UI/UX Review — GapVise AI (2026-09-26)

Reviewed both apps against the **UI UX Pro Max** rule priorities and the
**Vercel Web Interface Guidelines**, using screenshots of every page (desktop,
dark mode, 390px mobile) with a realistic demo dataset.

Status: **Fixed** in the `design/ui-refresh` branch · **Kept** (deliberate) · **Open** (follow-up).

## Critical

| # | Finding | Where | Status |
|---|---|---|---|
| 1 | Primary buttons in dark mode had white text on light blue (~3:1 contrast, below 4.5:1) | both apps | **Fixed** — accent fill `#2563EB` in both themes (5.17:1) |
| 2 | Candidate login's email field was unstyled (the styles only covered text/password fields) | `candidate-frontend/src/styles/cand-common.css` | **Fixed** |
| 3 | On mobile, the 13-item sidebar sat above every page's content | admin `Shell.tsx` | **Fixed** — top bar + slide-in drawer, closes on navigation/Escape, hidden drawer removed from tab order |
| 4 | Candidates table overflowed its card: action buttons cut off, dates wrapped onto 5 lines | admin `pages/Candidates.tsx` | **Fixed** — name+email in one cell, compact dates, clamped JD titles, one visible action + `⋯` menu |

## High

| # | Finding | Where | Status |
|---|---|---|---|
| 5 | 25 Unicode/emoji characters used as icons (✓ ✕ ⚠ ◷ ● ⊘ 🚩 🎙 ☀ ☾); the mic emoji rendered as a broken glyph | 12 files | **Fixed** — local SVG icon set |
| 6 | Status badges showed raw codes (`NO_SHOW`, `PENDING`) | admin `pages/shared.tsx` | **Fixed** — "No-show", "Pending"… with icon + tone |
| 7 | A solid red "Delete Candidate + Report" button on every row | admin Candidates | **Fixed** — moved into the row `⋯` menu |
| 8 | Logo read as a generic checkbox | both apps | **Fixed** — new brand mark (`brand/`) |
| 9 | Small buttons were ~26px tall | admin | **Fixed** — 32px small / 38px default; candidate 42px |
| 10 | Schedule showed the lowercased JD key instead of the JD title | admin `pages/Schedule.tsx` | **Fixed** |
| 11 | Integrity evidence showed empty "No snapshot" boxes | admin Results detail | **Fixed** — images as cards, other events as a compact list |

## Medium

| # | Finding | Status |
|---|---|---|
| 12 | No `theme-color` meta; browser chrome didn't follow the theme | **Fixed** (both apps, updates on toggle) |
| 13 | Almost no `prefers-reduced-motion` handling | **Fixed** — global reduced-motion rule |
| 14 | Overview showed plain "Loading…" for a multi-request page | **Fixed** — skeleton |
| 15 | Evidence `<img>` without width/height (layout shift) | **Fixed** — explicit size + `loading="lazy"` |
| 16 | Search placeholders truncated and without `…` | **Fixed** — search field with icon |
| 17 | Reminder count shown for completed interviews | **Fixed** — "—" unless Pending/No-show |
| 18 | System font only; weak typographic hierarchy | **Fixed** — Plus Jakarta Sans (self-hosted), type scale |

## Kept on purpose

| Finding (per generic guideline) | Why it stays |
|---|---|
| Paste is blocked in candidate answers (Vercel: "never block paste") | Integrity requirement, PRD §12.3 |
| Candidate app defaults to dark (plugin: "avoid dark by default") | PRD §12.0 — long focused sessions |
| URL doesn't reflect filters/tabs (Vercel: deep-link state) | Not in scope for this pass — see Open |

## Open (follow-ups)

- Sync Results/Candidates filters and tabs to the URL so views can be shared.
- Replace `window.confirm` for destructive actions with a styled confirmation dialog.
- Keyboard shortcut / command palette for power users.

## Candidate app redesign (2026-09-27)

The candidate app got its own layer, `pages/candidate.md`: serif questions, a
session bar with a time line, a per-question tracker, a docked self-view and a
composer with Ctrl/Cmd + Enter. It was checked at 1440px (dark and light) and
390px. At 390px the question now comes before the progress rail, and the
self-view shrinks to a 96px inlay.

## Admin redesign (2026-09-27)

The admin app moved onto the shared ink-and-paper palette and the serif, as the
"examiner's desk" counterpart to the candidate app:
- The Overview opens with a one-sentence brief built from live data, with each clause linking to the page that deals with it.
- Stat cards became one ledger row of figures.
- Table headers and labels are sentence case.
- Report transcripts show questions in the serif, as the candidate saw them.

Fixes found during the pass:
- Avatar initials split names on the letter "s" instead of on whitespace.
- Integrity events are now grouped by type with a count and time range; one report listed 85 events one per line.
- Row-level JD deletion now uses the quiet destructive button.
