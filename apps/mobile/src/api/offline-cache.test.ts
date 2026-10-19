import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { storage.set(key, value); },
  removeItem: async (key: string) => { storage.delete(key); },
} }));

import { fetchCachedList, readCachedList } from './offline-cache';

describe('offline list cache', () => {
  beforeEach(() => storage.clear());
  it('returns fresh data and caches it for offline use', async () => {
    const fresh = await fetchCachedList('applications:user:active', async () => [{ id: 'a1' }]);
    expect(fresh).toEqual({ data: [{ id: 'a1' }], offline: false });
    const stale = await fetchCachedList('applications:user:active', async () => { throw new Error('offline'); });
    expect(stale).toEqual({ data: [{ id: 'a1' }], offline: true });
  });
  it('returns null for an empty cache and keeps cache keys separate', async () => {
    expect(await readCachedList('tickets:user-a')).toBeNull();
    await fetchCachedList('tickets:user-a', async () => ['mine']);
    expect(await readCachedList('tickets:user-b')).toBeNull();
  });
});
