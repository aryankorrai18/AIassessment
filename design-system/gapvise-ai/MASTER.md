# GapVise AI — Design System (Master)

The single source of truth for how GapVise looks. Both apps implement these
tokens in `src/styles/index.css`; component CSS uses the semantic tokens only —
never raw hex values.

Starting point: the **UI UX Pro Max** recommendation for a B2B SaaS / HR-tech
dashboard (trust blue, slate neutrals, Plus Jakarta Sans, orange accent), with
one deliberate change — its suggested *glassmorphism* style is **not** used in
the apps, because frosted panels hurt legibility in dense tables. Glass effects
are reserved for marketing surfaces (hero banner, deck).

## 1. Brand

| Element | Value |
|---|---|
| Name | **GapVise AI** — wordmark "GapVise" in text color + "AI" in accent |
| Mark | Blue rounded square with a white "G" drawn with a deliberate gap and an **orange dot in the gap** — the skill gap GapVise finds. Files: `brand/logo-mark.svg`, `brand/logo-mark-mono.svg` |
| Personality | Trustworthy, precise, calm. Evidence over hype. |
| Voice | Plain, specific, second person. Say what happened and what to do next. |

**Exports:** `brand/logo-mark-{32,64,192,512}.png` and the wordmark lockups
`brand/logo-lockup-light.png` / `logo-lockup-dark.png` (transparent, for light
and dark backgrounds). Marketing: `brand/marketing/hero.html` is the source of
the landing hero (`hero-1920x1080.png`) and the social card (`og-1200x630.png`,
open the page with `?format=og`).

**Logo rules:** minimum size 16px (favicon); keep clear space ≥ ¼ of the mark's
width; never recolor the dot anything but orange; on dark backgrounds use the
same mark (it carries its own blue tile).

## 2. Color tokens

All text pairs are verified ≥ **4.5:1** (WCAG AA) in both themes.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F8FAFC` | `#020617` | Page background |
| `--surface` | `#FFFFFF` | `#0F172A` | Cards, tables, inputs |
| `--surface-2` | `#F1F5F9` | `#1E293B` | Table headers, subtle fills |
| `--border` / `--border-strong` | `#E2E8F0` / `#CBD5E1` | `#1E293B` / `#334155` | Dividers / control borders |
| `--text` | `#0F172A` | `#F1F5F9` | Primary text |
| `--text-muted` | `#475569` | `#94A3B8` | Secondary text |
| `--text-faint` | `#5E6B7E` | `#7C8BA1` | Hints, sub-lines (≥ 4.9:1 on every surface) |
| `--accent` | `#2563EB` | `#2563EB` | Primary buttons, active states (white text: 5.17:1) |
| `--accent-text` | `#1D4ED8` | `#93C5FD` | Links, accent-colored text |
| `--accent-soft` | `#EFF4FF` | `#172554` | Active nav, info badges |
| `--brand-orange` | `#EA580C` | `#FB923C` | Logo dot, marketing CTAs only — never for status |
| `--ok` / `--ok-soft` | `#15803D` / `#DCFCE7` | `#4ADE80` / `#052E16` | Success |
| `--warn` / `--warn-soft` | `#B45309` / `#FEF3C7` | `#FBBF24` / `#3B2A05` | Warning, pending |
| `--err` / `--err-soft` | `#B91C1C` / `#FEE2E2` | `#FCA5A5` / `#450A0A` | Errors, destructive text |
| `--danger` | `#DC2626` | `#DC2626` | Destructive button fill (white text: 4.83:1) |

**Status never relies on color alone:** every badge pairs a color with an icon
*and* a text label.

## 3. Typography

- **Family:** Plus Jakarta Sans (variable), self-hosted via
  `@fontsource-variable/plus-jakarta-sans` — no font CDN (see TECH_STACK's
  locked-down-network principle). Monospace: system UI mono (access keys, IDs, code).
- **Scale:** 12 · 13 · 14 (admin body) / 15 (candidate body) · 18 · 22 · 28px.
- **Weights:** 500 body emphasis, 600 labels/buttons, 700 card titles, 800 page titles and wordmark.
- **Rules:** line-height 1.55 for body; `text-wrap: balance` on headings;
  `font-variant-numeric: tabular-nums` for every number column; loading copy ends with `…`.

## 4. Space, shape, elevation, motion

| Token | Value |
|---|---|
| Spacing | 4px grid: 4 · 8 · 12 · 16 · 20 · 24 · 32 |
| Radius | 6 (small), 8 (controls), 12 (cards), full (pills, avatars) |
| Control height | 38px default, 32px small (admin); 42–44px (candidate) |
| Shadows | `--shadow-sm` (cards), `--shadow` (raised controls), `--shadow-lg` (menus, drawer, modals) |
| Motion | 120ms (hover/press), 180ms (drawers/toasts), easing `cubic-bezier(0.2, 0, 0, 1)` |

Transitions list their properties explicitly (never `transition: all`). All motion
collapses under `prefers-reduced-motion`.

## 5. Components

| Component | Spec |
|---|---|
| **Button** | Primary (accent fill), `secondary` (surface + border), `danger` (red fill, for confirming destruction), `danger-ghost` (red text, for rows), `small`, `icon-only` (with `aria-label`). Hover darkens, press nudges 1px. |
| **Status badge** (`.pill`) | Icon + label + tone. Interview statuses: Pending (warn, clock), Active (info, dot), Completed (ok, check), No-show (err, cross), Expired (err, ban). |
| **Table** | Uppercase 12px headers on `--surface-2`; 10×12px cells; row hover; primary cell = name over faint email; long text clamped with a tooltip; dates compact (`Sep 23, 12:09 AM`). |
| **Row actions** | One visible primary action + a `⋯` menu (`RowMenu`) for the rest, with destructive items at the bottom in red. |
| **Search** | Leading search icon; placeholder ends with `…`. |
| **Stat card** | Label, big tabular number, 3px tone stripe on the left. |
| **Navigation** | Fixed sidebar ≥ 901px; below that a top bar + slide-in drawer (hidden drawer is removed from tab order). |
| **Loading** | Skeleton blocks for page-level loads; inline "Loading…" for table rows. |
| **Icons** | Local SVG set (`components/Icons.tsx`, Lucide-style 2px strokes). **No emoji or Unicode symbols as icons.** Decorative icons are `aria-hidden`. |

## 6. Accessibility checklist (every change)

- Text contrast ≥ 4.5:1; focus ring visible on every interactive element (`:focus-visible`).
- Every input has a visible `<label>`; icon-only buttons have `aria-label`.
- Keyboard: menus open/close with Enter/Escape and move with arrow keys; dialogs trap focus where specified.
- Touch targets ≥ 32px (admin, desktop-first) and ≥ 42px (candidate app).
- Test at 390px, 768px, 1440px, in light and dark.

## 7. Deliberate exceptions

These break a generic guideline on purpose (see PRD):

- **Paste is blocked** in the candidate answer box and code editor — it's an
  integrity requirement (PRD §12.3), not an oversight.
- **The candidate app defaults to dark** (PRD §12.0) — long, focused sessions.
- **No auto-termination UI** for proctoring flags — banners and overlays only (PRD §6.6, §13).
