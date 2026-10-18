import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const repoRoot = path.resolve(__dirname, '../../..');
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

function fixture(action: 'create' | 'delete', runId: string) {
  const output = execFileSync('pnpm', ['--filter', '@biznexa/api', 'exec', 'tsx', 'test/fixtures/featured-consultant.ts', action, runId], {
    cwd: repoRoot,
    env: { ...process.env, API_URL: apiUrl },
    stdio: 'pipe',
  }).toString();
  return output ? JSON.parse(output) as { slug: string; language: string } : null;
}

test('filters consultants, books and pays for a slot, then shows the meeting link', async ({ page }, info) => {
  test.setTimeout(120_000);
  const runId = `${Date.now()}${info.project.name === 'mobile' ? '2' : '1'}`;
  const consultant = fixture('create', runId)!;
  try {
    await page.goto('/register');
    await page.getByLabel('Full name').fill(`Booking customer ${runId.slice(-5)}`);
    await page.getByLabel('Mobile number').fill(`9${runId.slice(-9)}`);
    await page.getByLabel('Email').fill(`pw-booking-${runId}@example.com`);
    await page.getByLabel('Password').fill('secret1234');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Verify your mobile number' })).toBeVisible();
    const code = await page.locator('text=Development mode: your code is').locator('span').innerText();
    await page.getByLabel('Verification code').fill(code);
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto(`/consultants?category=CA&language=${encodeURIComponent(consultant.language)}`);
    await expect(page.getByRole('heading', { name: `Featured E2E ${runId}` })).toBeVisible();
    await page.getByRole('link', { name: 'View profile' }).click();
    await page.getByRole('link', { name: 'Book a consultation' }).click();
    await page.getByRole('group', { name: '2. Date' }).getByRole('button').first().click();
    await page.getByRole('group', { name: '3. Time' }).getByRole('button').first().click();

    const held = page.waitForResponse((response) => response.url().includes('/api/bookings') && response.request().method() === 'POST' && response.status() === 201);
    await page.getByRole('button', { name: /Hold slot & pay/ }).click();
    await held;
    await page.getByRole('button', { name: /^Pay / }).click();
    await page.getByRole('button', { name: 'Complete test payment' }).click();

    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible({ timeout: 20_000 });
    const meetingLink = page.getByRole('link', { name: 'Join your consultation' });
    await expect(meetingLink).toHaveAttribute('href', /^https:\/\/meet\.jit\.si\//);
  } finally {
    fixture('delete', runId);
  }
});
