import type { Config } from 'tailwindcss';

/** Cor semântica com par "soft" (fundo suave + texto legível sobre ele). */
const withSoft = (name: string) => ({
  DEFAULT: `hsl(var(--${name}) / <alpha-value>)`,
  soft: `hsl(var(--${name}-soft) / <alpha-value>)`,
  'soft-foreground': `hsl(var(--${name}-soft-foreground) / <alpha-value>)`,
});

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1280px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        subtle: 'hsl(var(--subtle) / <alpha-value>)',
        sunken: 'hsl(var(--sunken) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        primary: {
          ...withSoft('primary'),
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        // Estados. Use estes em vez de green-/yellow-/red- crus: só assim o tema
        // escuro acompanha.
        positive: withSoft('positive'),
        warn: withSoft('warn'),
        danger: withSoft('danger'),
      },
      borderRadius: {
        xl: 'calc(var(--radius) + 4px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-in-right': 'slide-in-right 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
