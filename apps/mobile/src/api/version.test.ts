import { describe, expect, it } from 'vitest';
import { isVersionBelow } from './version';

describe('mobile version comparison', () => {
  it('compares numeric components rather than strings', () => {
    expect(isVersionBelow('1.9.0', '1.10.0')).toBe(true);
    expect(isVersionBelow('1.10.0', '1.9.0')).toBe(false);
  });
  it('treats missing trailing components as zero and accepts the minimum', () => {
    expect(isVersionBelow('1.2', '1.2.0')).toBe(false);
    expect(isVersionBelow('1.2.0', '1.2.1')).toBe(true);
  });
});
