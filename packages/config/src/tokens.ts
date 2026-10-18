/**
 * BizNexa design tokens shared across web, admin and mobile.
 * Aligned with packages/config/tokens.css (Tailwind 4 @theme).
 */

export const colors = {
  ink: '#1f2b7a',
  ink600: '#2c3a96',
  ink050: '#eef0fa',
  night: '#121a45',
  muted: '#545c80',
  paper: '#f6f7fb',
  rule: '#dce0ee',
  marigold: '#f4b000',
  marigold600: '#d99c00',
  seal: '#0e8a5f',
  seal050: '#e6f5ee',
  amber: '#b26a00',
  amber050: '#fff4dc',
  danger: '#b42318',
  danger050: '#fdecea',
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 9999,
} as const;

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const typography = {
  fontFamily: 'System',
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    display: 32,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;

export const theme = {
  colors,
  radius,
  spacing,
  typography,
} as const;

export type Theme = typeof theme;
export type ColorKey = keyof typeof colors;
