import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: { DEFAULT: '#0b0f14', 2: '#111821', 3: '#182230' },
        line: '#243140',
        fog: { DEFAULT: '#9fb0c3', 2: '#6b7d91' },
        paper: '#e8eef5',
        ping: { DEFAULT: '#37d7c4', dim: '#1d7f75' },
        yes: '#4ade80',
        no: '#f87171',
        amber: '#fbbf24',
      },
    },
  },
  plugins: [],
} satisfies Config;
