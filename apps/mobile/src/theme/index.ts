import { colors, radius, spacing, typography } from '@biznexa/config/tokens';

export { colors, radius, spacing, typography };

export const theme = {
  colors,
  radius,
  spacing,
  typography,
} as const;

export type Theme = typeof theme;
