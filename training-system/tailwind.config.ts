import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#00c07f',
          dark: '#00a36b',
          light: '#f0fdf9',
        },
        navy: {
          DEFAULT: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
          400: '#94a3b8',
          200: '#e2e8f0',
          100: '#f1f5f9',
          50:  '#f8fafc',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
