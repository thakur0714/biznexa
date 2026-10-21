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

test('published post appears in the listing and detail; draft stays hidden', async ({ page, request }) => {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const slug = `pw-public-blog-${run}`;
  const draftSlug = `${slug}-draft`;
  const email = `pw-blog-${run}@example.com`;
  const password = 'Playwright@12345'; // NOSONAR: test credential
  execFileSync('pnpm', ['--filter', '@biznexa/api', 'create-admin'], { cwd: path.resolve(__dirname, '../../..'), env: { ...process.env, ADMIN_NAME: 'Blog Playwright', ADMIN_EMAIL: email, ADMIN_MOBILE: `6${run.slice(-9).padStart(9, '0')}`, ADMIN_PASSWORD: password }, stdio: 'pipe' });
  const login = await request.post(`${apiUrl}/api/auth/login`, { data: { email, password } });
  expect(login.status()).toBe(200);
  const setup = await request.post(`${apiUrl}/api/auth/2fa/setup`, { headers: { authorization: `Bearer ${(await login.json()).accessToken}` } });
  expect(setup.status()).toBe(200);
  const secret = (await setup.json()).secret as string;
  const enabled = await request.post(`${apiUrl}/api/auth/2fa/enable`, { headers: { authorization: `Bearer ${(await login.json()).accessToken}` }, data: { code: totp(secret) } });
  expect(enabled.status()).toBe(200);
  const auth = { authorization: `Bearer ${(await enabled.json()).accessToken}` };
  const makePost = (postSlug: string, status: 'PUBLISHED' | 'DRAFT') => ({ title: `Browser Blog ${postSlug}`, slug: postSlug, excerpt: 'A public article excerpt.', content: '<h2>Article content</h2><p>Visible in the browser.</p>', featuredImage: null, authorName: 'BizNexa Writer', categoryIds: [], tagIds: [], seoTitle: null, metaDescription: null, status, publishAt: null });
  const publishedResponse = await request.post(`${apiUrl}/api/admin/blog/posts`, { headers: auth, data: makePost(slug, 'PUBLISHED') });
  expect(publishedResponse.status()).toBe(201);
  const publishedId = (await publishedResponse.json()).id as string;
  const draftResponse = await request.post(`${apiUrl}/api/admin/blog/posts`, { headers: auth, data: makePost(draftSlug, 'DRAFT') });
  expect(draftResponse.status()).toBe(201);
  const draftId = (await draftResponse.json()).id as string;
  try {
    await page.goto('/blog');
    await expect(page.getByRole('heading', { name: `Browser Blog ${slug}` })).toBeVisible();
    await expect(page.getByText(`Browser Blog ${draftSlug}`)).toHaveCount(0);
    await page.getByRole('link', { name: new RegExp(`Browser Blog ${slug}`) }).click();
    await expect(page).toHaveURL(new RegExp(`/blog/${slug}$`));
    await expect(page.getByRole('heading', { level: 1, name: `Browser Blog ${slug}` })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Article content' })).toBeVisible();
  } finally {
    await request.delete(`${apiUrl}/api/admin/blog/posts/${publishedId}`, { headers: auth });
    await request.delete(`${apiUrl}/api/admin/blog/posts/${draftId}`, { headers: auth });
  }
});
