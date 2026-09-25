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
        // deep navy base, three steps of elevation
        ink: { DEFAULT: '#0b0c14', 2: '#13151f', 3: '#1b1e2b' },
        line: '#262a3a',
        fog: { DEFAULT: '#9aa3b8', 2: '#6a7288' },
        paper: '#f2f4f8',
        // brand accent: electric blue, with violet as the second voice in charts and the logo
        ping: { DEFAULT: '#5b8def', dim: '#2f4f9a' },
        violet: { DEFAULT: '#a78bfa', dim: '#6d54c9' },
        yes: '#34d399',
        no: '#fb7185',
        amber: '#fbbf24',
      },
      borderRadius: { '2xl': '16px', '3xl': '22px' },
      boxShadow: { card: '0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 30px -18px rgba(0,0,0,0.7)' },
    },
  },
  plugins: [],
} satisfies Config;
