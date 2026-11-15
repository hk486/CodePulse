/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /**
         * A neutral ink ramp, not a colour.
         *
         * The chrome carries no hue, so the only colour on screen is the
         * severity of a finding. The ramp is used for surfaces, borders and
         * text, and it reads correctly in both themes.
         */
        primary: {
          50: '#f6f6f7',
          100: '#ebebed',
          200: '#dcdcdf',
          300: '#b4b4bb',
          400: '#8b8b95',
          500: '#6b6b76',
          600: '#4a4a53',
          700: '#35353c',
          800: '#232329',
          900: '#131317',
        },
        /**
         * The surfaces. Jet black in the dark theme, paper in the light one.
         */
        surface: {
          page: 'rgb(var(--surface-page) / <alpha-value>)',
          card: 'rgb(var(--surface-card) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        /**
         * Three text roles, no more.
         */
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          2: 'rgb(var(--ink-2) / <alpha-value>)',
          3: 'rgb(var(--ink-3) / <alpha-value>)',
        },
        /**
         * The interface accent. One hue for the things you can act on.
         */
        accent: 'rgb(var(--accent) / <alpha-value>)',
        /**
         * The severity ramp. The loudest colour on screen.
         */
        severity: {
          critical: 'rgb(var(--severity-critical) / <alpha-value>)',
          high: 'rgb(var(--severity-high) / <alpha-value>)',
          medium: 'rgb(var(--severity-medium) / <alpha-value>)',
          low: 'rgb(var(--severity-low) / <alpha-value>)',
          positive: 'rgb(var(--severity-positive) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'base': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'xl': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
      },
      spacing: {
        'xs': '0.5rem',
        'sm': '0.75rem',
        'md': '1rem',
        'lg': '1.5rem',
        'xl': '2rem',
        '2xl': '2.5rem',
        '3xl': '3rem',
      },
      borderRadius: {
        'xs': '0.25rem',
        'sm': '0.375rem',
        'base': '0.5rem',
        'md': '0.75rem',
        'lg': '1rem',
      },
    },
  },
  plugins: [],
}
