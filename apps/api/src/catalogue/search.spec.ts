import { editDistance, rank, tokenize } from './search';

const docs = [
  { id: '1', name: 'GST Registration', extra: 'Tax & GST', popularity: 90 },
  { id: '2', name: 'Trademark Registration', extra: 'Trademark', popularity: 95 },
  { id: '3', name: 'Private Limited Company Registration', extra: 'Company Registration', popularity: 100 },
  { id: '4', name: 'Import Export Code (IEC)', extra: 'Licenses', popularity: 40 },
];

describe('search', () => {
  it('expands common abbreviations', () => {
    expect(tokenize('Pvt Ltd regn')).toEqual(['private', 'limited', 'registration']);
  });

  it('measures edit distance with an early exit', () => {
    expect(editDistance('trademrk', 'trademark')).toBe(1);
    expect(editDistance('abc', 'xyzxyz', 2)).toBe(3);
  });

  it('ranks exact name matches above description matches', () => {
    expect(rank(docs, 'gst')[0].id).toBe('1');
  });

  it('tolerates typos and abbreviations', () => {
    expect(rank(docs, 'trademrk')[0].id).toBe('2');
    expect(rank(docs, 'pvt ltd')[0].id).toBe('3');
    expect(rank(docs, 'iec')[0].id).toBe('4');
  });

  it('requires every query word to match', () => {
    expect(rank(docs, 'gst trademark')).toHaveLength(0);
    expect(rank(docs, '')).toHaveLength(0);
  });
});
