import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';

function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const character of secret.toUpperCase()) { value = (value << 5) | alphabet.indexOf(character); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = mac.at(-1)! & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** M9.6: what an admin saves in Homepage content is what visitors see on `/`, right after saving. */
test('homepage shows the active CMS banners, counters, testimonials, FAQ and picked services', async ({ page, request }, testInfo) => {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `pw-home-${run}@example.com`;
  const password = 'Playwright@12345'; // NOSONAR: test credential
  execFileSync('pnpm', ['--filter', '@biznexa/api', 'create-admin'], { cwd: path.resolve(__dirname, '../../..'), env: { ...process.env, ADMIN_NAME: 'Homepage Playwright', ADMIN_EMAIL: email, ADMIN_MOBILE: `6${run.slice(-9).padStart(9, '0')}`, ADMIN_PASSWORD: password }, stdio: 'pipe' }); // NOSONAR: dev tool from PATH
  const login = await request.post(`${apiUrl}/api/auth/login`, { data: { email, password } });
  expect(login.status()).toBe(200);
  const first = { authorization: `Bearer ${(await login.json()).accessToken}` };
  const setup = await request.post(`${apiUrl}/api/auth/2fa/setup`, { headers: first });
  const enabled = await request.post(`${apiUrl}/api/auth/2fa/enable`, { headers: first, data: { code: totp((await setup.json()).secret as string) } });
  expect(enabled.status()).toBe(200);
  const auth = { authorization: `Bearer ${(await enabled.json()).accessToken}` };

  const before = await (await request.get(`${apiUrl}/api/admin/cms/homepage`, { headers: auth })).json();
  const services = (await (await request.get(`${apiUrl}/api/admin/cms/homepage/services`, { headers: auth })).json()) as { id: string; name: string }[];
  // Least popular services with a name of their own (test runs leave look-alike services behind).
  const picked = services.filter((s) => services.filter((o) => o.name === s.name).length === 1).slice(-2);
  const tag = `${testInfo.project.name}-${run}`;
  const save = await request.put(`${apiUrl}/api/admin/cms/homepage`, {
    headers: auth,
    data: {
      banners: [
        { title: `Banner ${tag}`, subtitle: 'Shown to visitors', imageUrl: null, linkUrl: '/consultants', sortOrder: 0, isActive: true },
        { title: `Hidden banner ${tag}`, subtitle: null, imageUrl: null, linkUrl: null, sortOrder: 1, isActive: false },
      ],
      testimonials: [{ name: `Reviewer ${tag}`, company: 'Playwright Foods', quote: 'Everything in one place.', rating: 5, sortOrder: 0, isActive: true }],
      stats: [
        { label: `Happy customers ${tag}`, value: '12,345', sortOrder: 0, isActive: true },
        { label: `Hidden counter ${tag}`, value: '0', sortOrder: 1, isActive: false },
      ],
      popularServiceIds: picked.map((s) => s.id),
      faq: [{ question: `Question ${tag}?`, answer: '<p>Answer from the CMS.</p>', sortOrder: 0, isActive: true }],
    },
  });
  expect(save.status()).toBe(200);

  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: `Banner ${tag}` })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`Banner ${tag}`) })).toHaveAttribute('href', '/consultants');
    await expect(page.getByText(`Hidden banner ${tag}`)).toHaveCount(0);
    await expect(page.getByText('12,345')).toBeVisible();
    await expect(page.getByText(`Happy customers ${tag}`)).toBeVisible();
    await expect(page.getByText(`Hidden counter ${tag}`)).toHaveCount(0);
    await expect(page.getByText(`Reviewer ${tag}`)).toBeVisible();
    const popular = page.locator('section[aria-labelledby="popular-h"]');
    for (const s of picked) await expect(popular.getByText(s.name, { exact: true })).toBeVisible();
    await page.getByText(`Question ${tag}?`).click();
    await expect(page.getByText('Answer from the CMS.')).toBeVisible();
  } finally {
    await request.put(`${apiUrl}/api/admin/cms/homepage`, { headers: auth, data: before });
  }
});
