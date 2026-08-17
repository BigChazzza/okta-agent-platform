import type { Config } from 'tailwindcss';
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        okta: { blue: '#00297a', accent: '#1662dd' },
      },
    },
  },
};
export default config;
