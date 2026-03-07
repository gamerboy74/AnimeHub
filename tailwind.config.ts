
import type { Config } from 'tailwindcss'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        green: {
          600: '#4A7043',
        },
        yellow: {
          400: '#F4E4BC',
        },
        pink: {
          200: '#D8A7B1',
          300: '#D8A7B1',
          400: '#c084a1',
        },
        teal: {
          500: '#2E5E5A',
          600: '#2E5E5A',
          700: '#2E5E5A',
          800: '#1a3d39',
        },
        cream: '#FDF6E3',
      },
      fontFamily: {
        'pacifico': ['"Pacifico"', 'serif'],
      },
      backgroundImage: {
        'gradient-magical': 'linear-gradient(135deg, #E8F0E9 0%, #F4E4BC 100%)',
      },
    },
  },
  plugins: [],
} satisfies Config
