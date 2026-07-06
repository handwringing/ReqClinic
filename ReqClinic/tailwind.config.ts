import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          900: 'var(--primary-900)',
          800: 'var(--primary-800)',
          700: 'var(--primary-700)',
          600: 'var(--primary-600)',
          500: 'var(--primary-500)',
        },
        accent: {
          700: 'var(--accent-700)',
          600: 'var(--accent-600)',
          500: 'var(--accent-500)',
          100: 'var(--accent-100)',
          50: 'var(--accent-50)',
        },
        success: { 700: 'var(--success-700)', 100: 'var(--success-100)' },
        warning: { 700: 'var(--warning-700)', 100: 'var(--warning-100)' },
        danger: { 700: 'var(--danger-700)', 100: 'var(--danger-100)' },
        info: { 700: 'var(--info-700)', 100: 'var(--info-100)' },
        slate: {
          900: 'var(--slate-900)', 800: 'var(--slate-800)', 700: 'var(--slate-700)',
          600: 'var(--slate-600)', 500: 'var(--slate-500)', 400: 'var(--slate-400)',
          300: 'var(--slate-300)', 200: 'var(--slate-200)', 100: 'var(--slate-100)', 50: 'var(--slate-50)',
        },
      },
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        xs: '11px', sm: '12px', base: '14px', md: '15px',
        lg: '16px', xl: '18px', '2xl': '20px', '3xl': '24px', '4xl': '32px',
      },
      borderRadius: {
        sm: '4px', md: '6px', lg: '8px', full: '9999px',
      },
      spacing: {
        1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px',
        6: '24px', 8: '32px', 10: '40px', 12: '48px', 16: '64px',
      },
      boxShadow: {
        1: 'var(--shadow-1)', 2: 'var(--shadow-2)', overlay: 'var(--shadow-overlay)',
      },
      transitionDuration: {
        fast: '100ms', normal: '150ms', slow: '200ms',
      },
      transitionTimingFunction: {
        default: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      height: {
        header: 'var(--header-height)',
        sidebar: 'var(--sidebar-width)',
      },
      width: {
        sidebar: 'var(--sidebar-width)',
        'right-panel': 'var(--right-panel-width)',
      },
    },
  },
  plugins: [],
};

export default config;
