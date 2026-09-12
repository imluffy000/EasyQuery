/**
 * Design tokens — "Instrument".
 *
 * Every colour is a CSS variable defined in index.css so light and dark are
 * one token swap, not two sets of utility classes. Nothing here introduces a
 * literal colour; if a component needs a colour it does not have, add the
 * token, not a hex.
 *
 * Radius is 0 by default on purpose: this system separates with rules and
 * ground shifts. `rounded-full` stays available for genuinely round things.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // `hover:` only applies on devices that can genuinely hover. Without this a
  // tap on a touch screen leaves the hover style stuck on until the next tap.
  future: { hoverOnlyWhenSupported: true },
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        elevated: 'rgb(var(--elevated) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        'border-control': 'rgb(var(--border-control) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        scrim: 'rgb(var(--scrim) / <alpha-value>)',
        // Chart series. Read these through getComputedStyle in Recharts —
        // it needs resolved values, not the rgb(var(--x)) wrapper.
        's-1': 'rgb(var(--series-1) / <alpha-value>)',
        's-2': 'rgb(var(--series-2) / <alpha-value>)',
        's-3': 'rgb(var(--series-3) / <alpha-value>)',
        's-4': 'rgb(var(--series-4) / <alpha-value>)',
        's-5': 'rgb(var(--series-5) / <alpha-value>)',
        's-6': 'rgb(var(--series-6) / <alpha-value>)',
        's-7': 'rgb(var(--series-7) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"Fira Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Dense scale: this is a workspace, not a marketing page. `3xl` exists
        // so KPI figures stay inside the system instead of falling back to
        // Tailwind's default.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        lg: ['1rem', { lineHeight: '1.5rem' }],
        xl: ['1.125rem', { lineHeight: '1.625rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.875rem' }],
        '3xl': ['1.75rem', { lineHeight: '2.125rem' }],
        // Display sizes exist ONLY for the public marketing surface, where a
        // workspace scale reads as timid. Never use these inside the app.
        '4xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em' }],
        '5xl': ['3rem', { lineHeight: '3.125rem', letterSpacing: '-0.025em' }],
      },
      spacing: { 4.5: '1.125rem', 13: '3.25rem', 15: '3.75rem' },
      borderRadius: { DEFAULT: '0px', none: '0px', sm: '0px', md: '0px', lg: '0px', full: '9999px' },
      boxShadow: {
        // The only lift in the system, and only for things that float above
        // the plane: popovers and the modal panel.
        popover: '0 8px 24px -6px rgb(var(--scrim) / 0.28), 0 0 0 1px rgb(var(--border-strong))',
      },
      // Motion tokens. Mirrors DURATION and EASE_OUT in src/lib/motion.ts;
      // change the two together so CSS and Motion keep one rhythm.
      transitionDuration: { DEFAULT: '120ms', fast: '140ms', base: '220ms', slow: '360ms' },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.22, 1, 0.36, 1)',
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(3px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Popover arriving from its trigger: a short drop plus a hair of scale.
        'pop-down': {
          from: { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // Result rows. Opacity only: a transform on <tr> is unreliable across
        // engines, and the stagger alone carries the sense of arrival.
        'row-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        // One ring expanding off a status dot when its status changes.
        'ping-once': {
          from: { opacity: '0.55', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(3)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 150ms ease-out',
        'pop-down': 'pop-down 160ms cubic-bezier(0.22, 1, 0.36, 1)',
        'row-in': 'row-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'ping-once': 'ping-once 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
        // Waits before showing, so a load that finishes quickly never flashes
        // a spinner at all.
        'fade-in-delayed': 'fade-in 220ms ease-out 300ms both',
      },
    },
  },
  plugins: [],
}
