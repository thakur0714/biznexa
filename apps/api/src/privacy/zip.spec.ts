import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip } from '../../test/zip-reader';
import { createZip } from './zip';

describe('createZip', () => {
  const entries = [
    { name: 'profile.json', data: JSON.stringify({ name: 'Asha Rao — ₹ प्रोफ़ाइल' }) },
    { name: 'nested/empty.txt', data: '' },
    { name: 'big.json', data: Buffer.from('x'.repeat(200_000)) },
  ];

  it('round-trips names (UTF-8) and contents with valid CRCs', () => {
    const files = readZip(createZip(entries, new Date('2026-10-17T10:20:30')));
    expect([...files.keys()]).toEqual(['profile.json', 'nested/empty.txt', 'big.json']);
    expect(JSON.parse(files.get('profile.json')!.toString('utf8'))).toEqual({ name: 'Asha Rao — ₹ प्रोफ़ाइल' });
    expect(files.get('nested/empty.txt')!.length).toBe(0);
    expect(files.get('big.json')!.length).toBe(200_000);
  });

  it('compresses', () => {
    expect(createZip([entries[2]]).length).toBeLessThan(2_000);
  });

  it('refuses entry names that could escape the folder', () => {
    expect(() => createZip([{ name: '../evil.txt', data: 'x' }])).toThrow('Invalid ZIP entry name');
    expect(() => createZip([{ name: '/etc/passwd', data: 'x' }])).toThrow('Invalid ZIP entry name');
  });

  it('is accepted by the system unzip, when there is one', () => {
    let hasUnzip = true;
    try {
      execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    } catch {
      hasUnzip = false;
    }
    if (!hasUnzip) return;
    const dir = mkdtempSync(join(tmpdir(), 'bn-zip-'));
    try {
      writeFileSync(join(dir, 'a.zip'), createZip(entries));
      expect(execFileSync('unzip', ['-t', join(dir, 'a.zip')]).toString()).toMatch(/No errors detected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
