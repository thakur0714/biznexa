import { describe, it, expect } from 'vitest';
import { colors, radius, spacing, typography, theme } from './index';

describe('Mobile Theme Tokens', () => {
  it('exports official BizNexa color palette matching web tokens.css', () => {
    expect(colors.ink).toBe('#1f2b7a');
    expect(colors.night).toBe('#121a45');
    expect(colors.marigold).toBe('#f4b000');
    expect(colors.seal).toBe('#0a6c4a');
    expect(colors.danger).toBe('#b42318');
    expect(colors.paper).toBe('#f6f7fb');
    expect(colors.rule).toBe('#dce0ee');
  });

  it('exports matching radius and spacing tokens', () => {
    expect(radius.sm).toBe(6);
    expect(radius.md).toBe(10);
    expect(radius.lg).toBe(16);
    expect(spacing.md).toBe(12);
    expect(spacing.lg).toBe(16);
  });

  it('provides a structured theme object', () => {
    expect(theme.colors).toBe(colors);
    expect(theme.radius).toBe(radius);
    expect(theme.spacing).toBe(spacing);
    expect(theme.typography).toBe(typography);
  });
});
