import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'bn_mobile_refresh_token';
const BIOMETRIC_ENABLED_KEY = 'bn_mobile_biometric_enabled';

// In-memory fallback for testing or non-native runtimes
const memoryFallback = new Map<string, string>();

async function isSecureStoreAvailable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function getStoredRefreshToken(): Promise<string | null> {
  try {
    if (await isSecureStoreAvailable()) {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    }
  } catch {
    // fallback below
  }
  return memoryFallback.get(REFRESH_TOKEN_KEY) ?? null;
}

export async function setStoredRefreshToken(token: string): Promise<void> {
  try {
    if (await isSecureStoreAvailable()) {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
      return;
    }
  } catch {
    // fallback below
  }
  memoryFallback.set(REFRESH_TOKEN_KEY, token);
}

export async function removeStoredRefreshToken(): Promise<void> {
  try {
    if (await isSecureStoreAvailable()) {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
      return;
    }
  } catch {
    // fallback below
  }
  memoryFallback.delete(REFRESH_TOKEN_KEY);
}

export async function getStoredBiometricsEnabled(): Promise<boolean> {
  try {
    if (await isSecureStoreAvailable()) {
      const val = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      return val === 'true';
    }
  } catch {
    // fallback below
  }
  return memoryFallback.get(BIOMETRIC_ENABLED_KEY) === 'true';
}

export async function setStoredBiometricsEnabled(enabled: boolean): Promise<void> {
  try {
    if (await isSecureStoreAvailable()) {
      await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
      return;
    }
  } catch {
    // fallback below
  }
  memoryFallback.set(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
}
