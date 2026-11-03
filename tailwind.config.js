/** @type {import('tailwindcss').Config} */
// Colors come from CSS variables (see client/src/index.css) so light and dark
// themes share one set of class names. `<alpha-value>` keeps bg-x/50 working.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./client/index.html', './client/src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        surface2: v('surface-2'),
        line: v('line'),
        ink: v('ink'),
        ink2: v('ink-2'),
        ink3: v('ink-3'),
        brand: { DEFAULT: v('brand'), soft: v('brand-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
        warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
        violet: { DEFAULT: v('violet'), soft: v('violet-soft') },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.12)',
        pop: '0 12px 40px -12px rgb(0 0 0 / 0.35)',
      },
      keyframes: {
        rise: { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
      animation: { rise: 'rise .25s ease-out both' },
    },
  },
}
