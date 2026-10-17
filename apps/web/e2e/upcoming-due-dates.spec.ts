import { expect, test } from '@playwright/test';
import { formatDate, type ReminderListResponse } from '@biznexa/types';

function dueDateIn(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(12, 0, 0, 0);
  return date.toISOString();
}

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('customer@biznexa.local');
  await page.getByLabel('Password').fill('Customer@12345');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('upcoming due dates show five reminders and a category-qualified renewal link', async ({ page }) => {
  const reminders: ReminderListResponse = {
    items: Array.from({ length: 6 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      type: 'COMPLIANCE',
      title: `Reminder ${index + 1}`,
      dueDate: dueDateIn(index + 2),
      renewServiceSlug: index === 0 ? 'gst-registration' : null,
      businessEntity: { name: 'Example Business' },
    })),
  };
  await page.route('**/api/reminders', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(reminders),
  }));
  await page.route('**/api/catalogue/services/gst-registration', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ category: { slug: 'tax-gst', name: 'Tax & GST' } }),
  }));

  await signIn(page);
  const widget = page.locator('section[aria-labelledby="upcoming-due-dates-heading"]');
  await expect(widget.getByRole('heading', { name: 'Upcoming due dates', exact: true })).toBeVisible();
  await expect(widget.locator('li')).toHaveCount(5);
  await expect(widget.getByText('Reminder 1')).toBeVisible();

  // Calculate days left using the exact same logic as the component to avoid flaky tests across timezones
  const daysLeft = (dueDate: string) => {
    const istDay = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(value));
    const calendarDay = (value: string) => {
      const [year, month, day] = istDay(value).split('-').map(Number);
      return Date.UTC(year, month - 1, day);
    };
    return Math.max(0, Math.round((calendarDay(dueDate) - calendarDay(new Date().toISOString())) / 86_400_000));
  };
  const remainingDays = daysLeft(reminders.items[0].dueDate);

  await expect(widget.getByText(`Due ${formatDate(reminders.items[0].dueDate)} · ${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} left`)).toBeVisible();
  await expect(widget.getByRole('link', { name: 'Renew' })).toHaveAttribute('href', '/services/tax-gst/gst-registration');
  await expect(widget.getByText('Reminder 6')).toHaveCount(0);
});

test('upcoming due dates show an empty state when the response has no reminders', async ({ page }) => {
  const reminders: ReminderListResponse = { items: [] };
  await page.route('**/api/reminders', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(reminders),
  }));

  await signIn(page);
  const widget = page.locator('section[aria-labelledby="upcoming-due-dates-heading"]');
  await expect(widget.getByRole('heading', { name: 'Upcoming due dates', exact: true })).toBeVisible();
  await expect(widget.getByRole('heading', { name: 'No upcoming due dates' })).toBeVisible();
});
