/**
 * Small typo-tolerant search over the service catalogue.
 * The catalogue is a few hundred rows at most, so an in-memory index beats a search cluster for the MVP.
 * Swap for Meilisearch/OpenSearch when blog posts and larger content join the index.
 */

const ALIASES: Record<string, string> = {
  pvt: 'private',
  ltd: 'limited',
  tm: 'trademark',
  trade: 'trademark',
  regn: 'registration',
  reg: 'registration',
  register: 'registration',
  incorporation: 'registration',
  itr: 'itr',
  iec: 'import export code',
  fssai: 'fssai',
  food: 'fssai',
  roc: 'roc',
  mca: 'mca',
  website: 'website',
  app: 'app',
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .flatMap((t) => (ALIASES[t] ?? t).split(' '));
}

/** Levenshtein distance with an early exit once it exceeds max. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function tokenScore(q: string, words: string[]): number {
  let best = 0;
  for (const w of words) {
    if (w === q) return 4;
    if (w.startsWith(q)) best = Math.max(best, 3);
    else if (q.length >= 3 && w.includes(q)) best = Math.max(best, 2);
    else if (q.length >= 4) {
      const d = editDistance(q, w.slice(0, Math.max(q.length, w.length)), 2);
      if (d <= (q.length >= 7 ? 2 : 1)) best = Math.max(best, 1.5);
    }
  }
  return best;
}

export interface SearchDoc {
  id: string;
  name: string;
  extra: string; // category name, short description
  popularity: number;
}

/** Returns docs ordered by relevance. Every query token must match the name or the extra text. */
export function rank<T extends SearchDoc>(docs: T[], query: string, limit = 10): T[] {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const scored: { doc: T; score: number }[] = [];
  for (const doc of docs) {
    const nameWords = tokenize(doc.name);
    const extraWords = tokenize(doc.extra);
    let total = 0;
    let allMatched = true;
    for (const q of qTokens) {
      const s = Math.max(tokenScore(q, nameWords) * 2, tokenScore(q, extraWords));
      if (s === 0) {
        allMatched = false;
        break;
      }
      total += s;
    }
    if (allMatched) scored.push({ doc, score: total + Math.min(doc.popularity, 100) / 100 });
  }
  return scored.toSorted((a, b) => b.score - a.score).slice(0, limit).map((s) => s.doc);
}
