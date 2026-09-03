# Page override — Landing (`/`)

Overrides `../MASTER.md` for the **public marketing surface only**
(`frontend/src/pages/Landing.tsx`). Master governs everywhere else; anything
not listed here inherits it unchanged.

## Why an override exists

The workspace is tuned for density: 14px base, a scale stopping at `text-3xl`,
8–32px spacing. That is correct for a tool someone operates all day and wrong
for a page someone reads once before deciding whether to sign up.

## What changes

| Aspect | Master (app) | Landing |
|---|---|---|
| Density | dense, 8–32px | relaxed, 40–80px section padding |
| Max heading | `text-3xl` (1.75rem) | `text-5xl` (3rem) |
| Body size | 13–14px | 14–16px, `leading-relaxed` |
| Content width | full-bleed panels | `max-w-6xl` centred |

**`text-4xl` and `text-5xl` were added to `tailwind.config.js` for this page
and must not appear anywhere inside the app.** They are commented as such in
the config.

## What does NOT change

Everything that carries the brand: warm-neutral tokens, the rust accent,
**square corners**, borders and ground shifts instead of shadows, Fira
Sans/Fira Code, `.micro` labels, and the contrast contract.

Grid gaps use the `gap-px` on a `bg-border` parent trick so feature and step
cards are separated by true hairlines rather than by shadow or radius.

## Rejected guidance

`--design-system` returned the pattern **"Scroll-Triggered Storytelling"**
(intro hook → chapters → climax CTA, with parallax and scroll-scrub). It was
rejected: it contradicts Master's "no scroll choreography — this is a tool",
and it contradicts the `--motion 2` dial that was passed to request subtle
motion. The **`landing` domain returned 0 results** for every query tried, so
the section structure below is standard practice plus the skill's priority
table — **not** a database match.

## Sections

1. **Sticky header** — wordmark, section anchors, `Sign in` + `Get started`
2. **Hero** — claim, sub-claim, dual CTA, and a still frame of a real turn
3. **How it works** — three numbered steps (numbered because genuinely sequential)
4. **Features** — six cards, hairline grid
5. **Security** — the guard's actual guarantees, the strongest argument this product has
6. **Final CTA**
7. **Footer**

The hero panel shows a real question → guard-rewritten SQL → result, using
values from the seeded `demo_analytics` database. It is labelled
*"Example turn"*: it must never be presented as the visitor's own data.

## Routing

- `/` — this page. Signed-in visitors are redirected to `/dashboard`.
- `/login`, `/register` — both render `LoginPage`, whose mode is derived from
  the path so each is linkable and bookmarkable.
- `/dashboard` — the former `/`. Moved so the root could become public.
- Signing out returns to `/`, not to a bare login form.
