/**
 * Builds a Tailwind color scale whose shades read the theme variables from
 * src/styles/themes.css. The variables hold RGB channels so Tailwind can
 * inject the opacity of modifiers like `bg-white/10` through <alpha-value>.
 */
const themedScale = (name) =>
  Object.fromEntries(
    ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'].map((shade) => [
      shade,
      `rgb(var(--c-${name}-${shade}) / <alpha-value>)`,
    ])
  );

const themedColor = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        'nav': '1310px',
      },
      // Neutral and accent scales follow the active theme (see themes.css).
      // Status colors stay fixed because they carry meaning in every theme.
      colors: {
        gray: themedScale('gray'),
        blue: themedScale('blue'),
        purple: themedScale('purple'),
        indigo: themedScale('indigo'),
        white: themedColor('white'),
        primary: themedColor('primary'),
        secondary: themedColor('secondary'),
        success: '#27ae60',
        danger: '#e74c3c',
        warning: '#e67e22',
        info: themedColor('secondary'),
        dark: themedColor('dark'),
        light: themedColor('light'),
      },
      fontFamily: {
        heading: 'var(--font-heading)',
      },
      backgroundImage: {
        'gradient-purple': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'gradient-blue': 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
        'gradient-dark-blue': 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
        'gradient-orange': 'linear-gradient(135deg, #ff7a45 0%, #ff5c3d 100%)',
        'gradient-green': 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)',
      },
      boxShadow: {
        'sm': '0 2px 4px rgba(0, 0, 0, 0.1)',
        'md': '0 4px 12px rgba(0, 0, 0, 0.08)',
        'lg': '0 4px 12px rgba(102, 126, 234, 0.4)',
        'focus': '0 0 0 3px rgba(52, 152, 219, 0.1)',
      },
      animation: {
        'slideDown': 'slideDown 0.3s ease-out',
        'fadeIn': 'fadeIn 0.3s ease-out',
        'slideIn': 'slideIn 0.3s ease-out',
        'slideInUp': 'slideInUp 0.3s ease-out',
        'shimmer': 'shimmer 2s infinite',
      },
      keyframes: {
        slideDown: {
          'from': { opacity: '0', transform: 'translateY(-10px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          'from': { opacity: '0' },
          'to': { opacity: '1' },
        },
        slideIn: {
          'from': { transform: 'translateY(-50px)', opacity: '0' },
          'to': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInUp: {
          'from': { opacity: '0', transform: 'translateY(20px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
    },
  },
  plugins: [],
}
