import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './index';

describe('safeRedirectPath', () => {
  it('keeps same-site paths with query and hash', () => {
    expect(safeRedirectPath('/dashboard', '/')).toBe('/dashboard');
    expect(safeRedirectPath('/apply/gst?pkg=std#pay', '/')).toBe('/apply/gst?pkg=std#pay');
  });

  it('falls back for empty, relative or absolute URLs', () => {
    expect(safeRedirectPath(null, '/home')).toBe('/home');
    expect(safeRedirectPath('', '/home')).toBe('/home');
    expect(safeRedirectPath('dashboard', '/home')).toBe('/home');
    expect(safeRedirectPath('https://evil.com', '/home')).toBe('/home');
    expect(safeRedirectPath('javascript:alert(1)', '/home')).toBe('/home');
  });

  it('blocks protocol-relative and backslash/whitespace tricks that browsers treat as another host', () => {
    expect(safeRedirectPath('//evil.com', '/home')).toBe('/home');
    expect(safeRedirectPath('/\\evil.com', '/home')).toBe('/home');
    expect(safeRedirectPath('/\t/evil.com', '/home')).toBe('/home');
    expect(safeRedirectPath('/\n/evil.com', '/home')).toBe('/home');
  });
});
