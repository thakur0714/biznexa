import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockStore = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  isAvailableAsync: vi.fn(async () => true),
  getItemAsync: vi.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    mockStore.delete(key);
  }),
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
}));

import {
  getStoredRefreshToken,
  setStoredRefreshToken,
  removeStoredRefreshToken,
  getStoredBiometricsEnabled,
  setStoredBiometricsEnabled,
} from './secure-storage';

describe('Secure Storage Helper', () => {
  beforeEach(async () => {
    mockStore.clear();
    await removeStoredRefreshToken();
    await setStoredBiometricsEnabled(false);
  });

  it('stores and retrieves refresh token securely', async () => {
    expect(await getStoredRefreshToken()).toBeNull();
    await setStoredRefreshToken('test-mobile-refresh-token-xyz');
    expect(await getStoredRefreshToken()).toBe('test-mobile-refresh-token-xyz');
  });

  it('removes stored refresh token on logout', async () => {
    await setStoredRefreshToken('token-to-delete');
    expect(await getStoredRefreshToken()).toBe('token-to-delete');
    await removeStoredRefreshToken();
    expect(await getStoredRefreshToken()).toBeNull();
  });

  it('persists biometric enabled flag', async () => {
    expect(await getStoredBiometricsEnabled()).toBe(false);
    await setStoredBiometricsEnabled(true);
    expect(await getStoredBiometricsEnabled()).toBe(true);
    await setStoredBiometricsEnabled(false);
    expect(await getStoredBiometricsEnabled()).toBe(false);
  });
});
