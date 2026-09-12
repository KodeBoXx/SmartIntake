/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        /* Certinal Brand: Emerald / Teal Scale (PRIMARY) */
        emerald: {
          50: '#E6F5F0',
          100: '#E6F5F0',
          200: '#B3E0D2',
          300: '#80CCB5',
          400: '#25C999',
          500: '#1A7A5E',
          600: '#1A7A5E',
          700: '#15654D',
          800: '#0F4A38',
          900: '#0A2F1F',
        },
        /* Certinal Brand: Cyan Scale (ACCENT) */
        cyan: {
          50: '#ECFEFF',
          100: '#CFFAFE',
          200: '#A5F3FC',
          300: '#67E8F9',
          400: '#22D3EE',
          500: '#0891B2',
          600: '#0E7490',
          700: '#155E75',
          800: '#164E63',
          900: '#0C3547',
        },
        /* Certinal Brand: Lime Scale (HIGHLIGHT) */
        lime: {
          50: '#F7FEE7',
          100: '#ECFCCB',
          200: '#D9F99D',
          300: '#BEF264',
          400: '#A3E635',
          500: '#84CC16',
          600: '#65A30D',
          700: '#4D7C0F',
          800: '#3F6212',
          900: '#365314',
        },
        /* Certinal Slate Scale */
        slate: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
        /* Semantic aliases */
        forest: {
          DEFAULT: '#0A2F1F',
          light: '#123626',
        },
        teal: {
          50: '#E6F5F0',
          400: '#25C999',
          500: '#1A7A5E',
          600: '#15654D',
          700: '#10503D',
        },
        'ds-lime': {
          DEFAULT: '#C4E538',
          hover: '#B5D42E',
          50: '#F7FCE4',
        },
        sage: '#C5D8A8',
        mint: {
          DEFAULT: '#E8F2DC',
          light: '#F4F8EE',
        },
        'card-bar': '#042129',
      },
      fontFamily: {
        sans: ['"DM Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        body: ['"DM Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"DM Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"DM Mono"', 'ui-monospace', '"Cascadia Mono"', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '24px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgba(15, 23, 42, 0.04)',
        md: '0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.04)',
        lg: '0 10px 15px -3px rgba(15, 23, 42, 0.06), 0 4px 6px -4px rgba(15, 23, 42, 0.04)',
        xl: '0 20px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
        card: '0 0 12px rgba(0, 0, 0, 0.08)',
        'card-sm': '0 0 12px rgba(0, 0, 0, 0.06)',
      },
      transitionTimingFunction: {
        'ds': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        'fast': '150ms',
        'base': '200ms',
      },
    },
  },
};
