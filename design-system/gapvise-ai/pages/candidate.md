# Candidate app — page override

Overrides `MASTER.md` for `packages/candidate-frontend`. Anything not listed here
follows the master (brand mark, icons, accessibility checklist, no emoji).

## Idea

The candidate is an engineer answering long questions under time pressure, for
60–90 minutes, often nervous. The screen should feel like a well-set **exam
paper**, not a dashboard: the question gets the page, everything else stays
quiet, and the two things a candidate keeps checking — *how long is left* and
*how far am I* — are always visible without being loud.

**The one bold move is typographic:** questions and page titles are set large in
a serif, like a printed exam question. Everything else is disciplined.

## Color

Same semantic token names as the master; the candidate values are tuned for a
long dark session (dark is the default, PRD §12.0). All text pairs ≥ 4.5:1.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--bg` | `#0B1020` (ink) | `#F4F6FA` (paper) | Page |
| `--surface` / `--surface-2` | `#111830` / `#18203B` | `#FFFFFF` / `#EEF1F7` | Panels, composer / subtle fills |
| `--text` / `--text-muted` / `--text-faint` | `#E9EDF7` / `#A3ADC7` / `#8590AE` | `#10162E` / `#4A5470` / `#5E6883` | Text |
| `--accent` | `#2563EB` | `#2563EB` | "You are here": current question, primary action, time line |
| `--signal` | `#FB923C` | `#C2410C` | The logo dot's orange — **only** for time running low (< 5 min) |
| `--banner-bg` / `--banner-text` | `#FCD34D` / `#1C1400` | same | Proctoring banners — one amber in both themes |

Orange never means anything except time pressure; red is reserved for flags,
recording and destructive actions.

## Type

| Role | Face | Use |
|---|---|---|
| Serif | Newsreader (variable, self-hosted) | Question prompts (30px, 23px on phones), page titles (40px), dialog titles, big figures |
| Sans | Plus Jakarta Sans (brand) | All interface text, answers (16.5px / 1.7) |
| Mono | JetBrains Mono (self-hosted) | **Only** inside the code editor and the access-key field. Ligatures off, so `<>` and `!=` show as typed |

Sentence case everywhere; no all-caps labels; no `→` glyphs in button text.

## Interview screen

```
┌ session bar ────────────────────────────────────────────────────────┐
│ [G] │ Scenarios            ● Proctoring on │  18:25            ☀     │
│     │ Question 3 of 15                     │  left in Scenarios      │
├━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━───────────── time line
│ ┌──────────┐   Question 3 of 15                                      │
│ │ self-view│   What does the @Transactional annotation               │  serif
│ └──────────┘   guarantee, and what are its propagation levels?       │
│ Maya Iyer                                                            │
│ ✓ Definitions 6/8  ■■■■■■┆┆  ┌ composer ───────────────────────────┐ │
│   Scenarios  2/15  ■■◉□□□…   │                                      │ │
│   Coding     0/3   □□□       │                                      │ │
│ ─────────────────            ├──────────────────────────────────────┤ │
│ [Submit Scenarios]           │ 🎙 Answer by voice   84 words ⌃↵ [Submit answer] │
└──────────────────────────────────────────────────────────────────────┘
```

- **Time line** — 3px under the bar; its length is the share of section time
  left. Blue, then orange under 5 minutes (with the clock).
- **Tracker marks** — filled = answered, ringed dot = current, dashed =
  skipped by submitting the section, outline = upcoming. Decorative; the
  `answered / total` count carries the meaning for screen readers.
- **Composer** — the answer box and its controls are one object with one focus
  ring. Ctrl/Cmd + Enter submits.
- **Self-view** — docked in the rail (it's part of "you"), floating
  bottom-right below 960px.
- Below 960px the rail folds under the question; the question always comes
  first.

## Motion

Only what answers an action or carries state: the time line shrinking each
second, the pulsing proctoring dot, the recording blink. No entrance animations.
All of it stops under `prefers-reduced-motion`.
