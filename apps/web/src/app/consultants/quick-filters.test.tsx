import { describe, expect, it } from 'vitest';
import { chipHref } from './quick-filters';

describe('chipHref', () => {
  it('sets the filter when it is not active', () => {
    expect(chipHref({}, 'category', 'CA')).toBe('/consultants?category=CA');
  });

  it('replaces a different value for the same filter', () => {
    expect(chipHref({ category: 'CS' }, 'category', 'LAWYER')).toBe('/consultants?category=LAWYER');
  });

  it('toggles the filter off when it is already active', () => {
    expect(chipHref({ category: 'CA' }, 'category', 'CA')).toBe('/consultants');
    expect(chipHref({ minRating: '4', city: 'Pune' }, 'minRating', '4')).toBe('/consultants?city=Pune');
  });

  it('keeps every other param', () => {
    const href = chipHref({ city: 'Pune', sort: 'fee_low', minRating: '4' }, 'availableToday', 'true');
    const params = new URL(href, 'http://localhost').searchParams;
    expect(params.get('city')).toBe('Pune');
    expect(params.get('sort')).toBe('fee_low');
    expect(params.get('minRating')).toBe('4');
    expect(params.get('availableToday')).toBe('true');
  });

  it('resets the page to 1 when setting or clearing a filter', () => {
    expect(chipHref({ page: '3', city: 'Pune' }, 'category', 'CA')).toBe('/consultants?city=Pune&category=CA');
    expect(chipHref({ page: '3', category: 'CA' }, 'category', 'CA')).toBe('/consultants');
  });
});
