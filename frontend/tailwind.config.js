/**
 * Design tokens.
 *
 * Every colour is a CSS variable defined in index.css, so light and dark are
 * one token swap rather than two sets of utility classes. Dark mode is a real
 * palette of neutral surfaces, not an inversion.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        elevated: 'rgb(var(--elevated) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-fg': 'rgb(var(--accent-fg) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
      },
      fontFamily: {
        // From the ui-ux-pro-max typography pairing for developer tools.
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Dense scale: this is a workspace, not a marketing page.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        lg: ['1rem', { lineHeight: '1.5rem' }],
        xl: ['1.125rem', { lineHeight: '1.625rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.875rem' }],
      },
      spacing: { 4.5: '1.125rem', 13: '3.25rem', 15: '3.75rem' },
      borderRadius: { DEFAULT: '0.375rem', sm: '0.25rem', md: '0.375rem', lg: '0.5rem' },
      boxShadow: {
        // Restrained: separation comes from borders, not drop shadows.
        panel: '0 1px 2px 0 rgb(0 0 0 / 0.06)',
        popover: '0 4px 16px -2px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(var(--border) / 0.6)',
      },
      transitionDuration: { DEFAULT: '150ms' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
      },
    },
  },
  plugins: [],
}
