import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      spacing: {
        4.5: '1.125rem',
      },
      colors: {
        // CSS-var-driven so dark/light flips happen via [data-theme] without
        // class swaps. See src/styles/globals.css for the source of truth.
        bg: 'var(--bg)',
        'bg-2': 'var(--bg-2)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        'text-muted': 'var(--text-muted)',
        'text-faint': 'var(--text-faint)',
        accent: 'var(--accent)',
        'accent-2': 'var(--accent-2)',
        'accent-soft': 'var(--accent-soft)',
        'accent-fg': 'var(--accent-fg)',
        success: 'var(--success)',
        'success-soft': 'var(--success-soft)',
        warning: 'var(--warning)',
        'warning-soft': 'var(--warning-soft)',
        danger: 'var(--danger)',
        'danger-soft': 'var(--danger-soft)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius-sm)',
        lg: 'var(--radius-lg)',
      },
      fontFamily: {
        sans: 'var(--font)',
        mono: 'var(--mono)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow)',
        lg: 'var(--shadow-lg)',
      },
      keyframes: {
        slideUp: {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        toastIn: {
          from: { opacity: '0', transform: 'translate(-50%, -8px)' },
          to: { opacity: '1', transform: 'translate(-50%, 0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        flashIn: {
          '0%': {
            opacity: '0',
            transform: 'translateY(-8px)',
            background: 'var(--accent-soft)',
          },
          '60%': { background: 'var(--accent-soft)' },
          '100%': { opacity: '1', transform: 'translateY(0)', background: 'transparent' },
        },
        pulse: {
          '0%, 100%': { boxShadow: '0 0 0 2px oklch(0.7 0.13 150 / 0.3)' },
          '50%': { boxShadow: '0 0 0 5px oklch(0.7 0.13 150 / 0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        spin: {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'slide-up': 'slideUp 240ms cubic-bezier(0.32, 0.72, 0, 1)',
        'toast-in': 'toastIn 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fadeIn 180ms ease-out',
        'flash-in': 'flashIn 600ms ease-out',
        'pulse-dot': 'pulse 2s infinite',
        shimmer: 'shimmer 1.4s infinite',
        spin: 'spin 1s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
