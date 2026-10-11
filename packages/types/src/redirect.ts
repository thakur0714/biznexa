/**
 * Returns `next` only if it is a path on this site, else `fallback`. Used for `?next=` after login.
 * Parsing with URL catches tricks a prefix check misses: `/\evil.com` and `/\t/evil.com` both
 * resolve to another host in browsers.
 */
export function safeRedirectPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/')) return fallback;
  const base = 'http://same.invalid';
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  return url.pathname + url.search + url.hash;
}
