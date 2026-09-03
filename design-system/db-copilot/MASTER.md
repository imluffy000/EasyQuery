# DB Copilot — "Instrument" Design System

Source of truth for the frontend's visual language. The implementation lives in
`frontend/src/index.css` (tokens) and `frontend/tailwind.config.js` (scale).
**Change those files, not component classes.**

Derived with the `ui-ux-pro-max` skill: style category *Minimalism & Swiss*,
typography pairing *Dashboard Data*. The palette is **not** from the skill's
database — it has no warm-neutral entry, so the colour system below was
authored and validated locally.

---

## The three rules

1. **Separation is a rule or a ground shift, never a shadow.** `shadow-popover`
   exists for genuinely floating things (the selector popup, the wizard panel,
   chart tooltips) and nothing else.
2. **Corners are square.** `borderRadius.DEFAULT` is `0px`. `rounded-full`
   remains for genuinely round things (status dots) so roundness stays
   meaningful.
3. **Neutrals are warm.** Bone in light, oil in dark — not blue-grey. One
   chromatic accent (muted rust); every other colour must earn its place
   semantically.

### Why not the previous system

The old palette was near-black `#0F172A` with an acid-green `#22C55E` accent —
a combination that reads as machine-generated, and one the skill lists among
its own anti-patterns. The warm ground and rust accent were chosen to sit in
the same functional territory without that signature.

---

## Colour

Tokens are `R G B` triples consumed as `rgb(var(--token) / <alpha>)`.
**Never write a hex or `rgb()` literal in a component.**

| Role | Light | Dark |
|---|---|---|
| `--bg` page ground | `237 233 225` | `26 24 21` |
| `--surface` panel | `250 248 243` | `36 33 29` |
| `--elevated` header/hover | `243 240 232` | `46 42 37` |
| `--sunken` trough | `228 223 213` | `20 18 16` |
| `--border` hairline | `214 208 196` | `60 55 48` |
| `--border-strong` structural | `186 178 163` | `84 77 67` |
| `--border-control` bounds inputs | `137 129 114` | `122 113 99` |
| `--fg` primary text | `28 26 23` | `240 236 229` |
| `--muted` secondary text | `92 86 76` | `174 166 153` |
| `--subtle` tertiary text | `107 100 88` | `159 151 137` |
| `--accent` | `150 66 26` | `224 138 92` |
| `--danger` / `--warn` / `--info` / `--ok` | semantic | semantic |

### Contrast contract

Every foreground token clears **4.5:1 against `--bg`, `--surface` and
`--elevated`, in both themes**. `--border-control` clears **3:1**, because it is
the only thing separating an input from its container.

Measured minimums: light `--subtle` 4.83, `--warn` 5.12; dark `--subtle` 4.93.
`--border-control` 3.18 light / 3.33 dark.

> The previous system shipped `--subtle` at **3.23:1**, used in 66 places across
> 16 files. Do not hand-edit a channel without re-running the numbers.

### Chart series

`--series-1..7`, Okabe-Ito derived, ordered most-used first. Recharts writes SVG
attributes and cannot resolve `rgb(var(--x))`, so components read these with
`getComputedStyle` — see `useSeriesColors()` in `components/result/ChartView.tsx`.

Colour-vision separation (min ΔE across normal + deuteranopia + protanopia):

| Series count | Light | Dark |
|---|---|---|
| 3 | 36.1 | 51.4 |
| 4 — the common case | 17.9 | 19.0 |
| 7 — maximum | **1.1** | 17.2 |

Okabe-Ito itself scores 17.2 at seven, so ~17 is the achievable ceiling, not a
shortfall. **Light mode is safe to four series and degrades beyond it.** Seven
categorical hues cannot be made robustly distinguishable, so colour is never
the only channel: every multi-series chart carries a legend, and pies label
slices directly. That redundancy is load-bearing — do not remove it to tidy a
chart.

---

## Typography

- **Body / UI:** Fira Sans (400/500/600)
- **Data, SQL, identifiers, all numerals:** Fira Code
- Loaded via `<link>` in `index.html`, not an `@import` inside the CSS bundle —
  an import there is only discovered after CSS parse and flashes the fallback.

Scale stops at `text-3xl`. Anything larger falls out of the system.
Base is 14px: this is a workspace, not a marketing page.

Numerals use `font-mono` + `tabular-nums` wherever they align in columns.

### `.micro`

The house label: `text-2xs`, uppercase, `tracking-[0.12em]`, `text-subtle`.
Used for section eyebrows, stat labels, table headers and status keys. It is
what makes the interface read as an instrument rather than a document.

---

## Component conventions

| Class | Purpose |
|---|---|
| `.panel` | Bounded region: surface ground, hairline border, square |
| `.field` | Every text input and select; bounded by `--border-control` |
| `.label` | Form label — uppercase, spaced, `--muted` |
| `.micro` | Small uppercase label (see above) |
| `.data-table` | Dense result grid with drawn column rules |
| `.readout` | Monospace key/value status strip under a result |

Primitives live in `components/ui/index.tsx`. `Input` and `Select` generate
their own `id` via `useId`, so **passing the `label` prop is sufficient** — never
hand-roll a `<label>` beside a field, which is how 19 controls previously ended
up with no accessible name.

`AsyncBoundary` is the standard async surface: **an error beats an empty state,
an empty state beats rendering nothing.** A failed fetch must never render as a
zero or as "nothing here".

`ConfirmDelete` is the only delete gesture. Every destructive path confirms,
shows pending, and surfaces failure.

---

## Layout & responsive

Dense by design: 8–32px spacing, 28px table rows, 32px controls.

The declared floor is **375px**. Below `lg` (1024px) the nav collapses to an
icon rail and the schema tree and details drawer stop competing for width —
three fixed columns inside an `overflow-hidden` main is what previously clipped
content rather than reflowing it.

## Motion

Subtle only. 120ms default transition, 150ms enter. `prefers-reduced-motion` is
honoured globally in `index.css`. No scroll choreography — this is a tool.
