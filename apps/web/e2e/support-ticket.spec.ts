import { expect, test } from '@playwright/test';

test('customer raises a support ticket and can open its detail', async ({ page }, info) => {
  const stamp = `${Date.now()}-${info.project.name}`;
  const subject = `Playwright support request ${stamp}`;

  await page.goto('/login');
  await page.getByLabel('Email').fill('customer@biznexa.local');
  await page.getByLabel('Password').fill('Customer@12345');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/dashboard/support');
  await expect(page.getByRole('heading', { name: 'Support Tickets' })).toBeVisible();
  await page.getByRole('button', { name: 'Raise New Ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'Raise Support Ticket' });
  await dialog.getByLabel('Subject').fill(subject);
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Description').fill('I need help understanding the documents required for my service.');
  await dialog.getByRole('button', { name: /Submit Ticket|Create Ticket|Raise Ticket/i }).click();

  await expect(page.getByRole('heading', { name: subject })).toBeVisible();
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  await expect(page.getByText('I need help understanding the documents required for my service.')).toBeVisible();
});
