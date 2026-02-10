/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx,md,mdx}',
    './docs/**/*.mdx',
    './blog/**/*.mdx',
    './docusaurus.config.js',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  corePlugins: {
    preflight: false, // Disable preflight to avoid conflicts with Infima
  },
  theme: {
    extend: {
      colors: {
        // Primary blue palette
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Neutral gray palette
        surface: {
          light: '#ffffff',
          muted: '#f9fafb',
          dark: '#111827',
          darker: '#1f2937',
        },
        // Text colors for components
        content: {
          primary: '#111827',
          secondary: '#6b7280',
          muted: '#9ca3af',
          inverse: '#f9fafb',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Source Sans Pro', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
        serif: ['EB Garamond', 'Georgia', 'Times New Roman', 'serif'],
      },
      boxShadow: {
        'subtle': '0 1px 3px rgba(0, 0, 0, 0.1)',
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'elevated': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      },
    },
  },
  plugins: [],
};
