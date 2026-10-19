import AsyncStorage from '@react-native-async-storage/async-storage';

const cacheKey = (key: string) => `biznexa:offline:${key}`;

export async function readCachedList<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(cacheKey(key));
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { await AsyncStorage.removeItem(cacheKey(key)); return null; }
}

export async function writeCachedList<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(cacheKey(key), JSON.stringify(value));
}

export async function fetchCachedList<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T; offline: boolean }> {
  let data: T;
  try {
    data = await fetcher();
  } catch (error) {
    const data = await readCachedList<T>(key);
    if (data !== null) return { data, offline: true };
    throw error;
  }
  await writeCachedList(key, data).catch(() => undefined);
  return { data, offline: false };
}
