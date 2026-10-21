import { expect, test } from '@playwright/test';
import { consultantApplicationInputSchema, type ConsultantApplicationInput, type ConsultantApplicationResponse, type StoredFileResult } from '@biznexa/types';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('customer@biznexa.local');
  await page.getByLabel('Password').fill('Customer@12345');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('consultant application collects profile and three proof uploads', async ({ page }) => {
  const fileIds = [
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
  ];
  const uploadResponse: StoredFileResult = {
    id: fileIds[0]!, fileName: 'proof.pdf', mimeType: 'application/pdf', sizeBytes: 12,
    sha256: 'a'.repeat(64), requirementId: null, scanStatus: 'PENDING', createdAt: new Date().toISOString(),
  };
  const submitted: ConsultantApplicationResponse = { id: '20000000-0000-4000-8000-000000000001', verificationStatus: 'PENDING' };
  const requests: ConsultantApplicationInput[] = [];
  let uploadIndex = 0;
  await page.route('**/api/files', (route) => {
    const body = { ...uploadResponse, id: fileIds[uploadIndex] ?? fileIds[0]! };
    uploadIndex += 1;
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/api/consultants', async (route) => {
    requests.push(consultantApplicationInputSchema.parse(route.request().postDataJSON()));
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(submitted) });
  });

  await signIn(page);
  await page.goto('/consultants/apply');
  await page.getByLabel('Qualification', { exact: true }).fill('Chartered Accountant');
  await page.getByLabel('Membership number (ICAI / ICSI / Bar Council)').fill('ICAI-1234');
  await page.getByLabel('Expertise (comma separated)').fill('GST, company law');
  await page.getByLabel('Languages (comma separated)').fill('English, Hindi');
  await page.getByLabel('City', { exact: true }).fill('Mumbai');
  await page.getByLabel('State', { exact: true }).fill('Maharashtra');
  await page.getByLabel('Fee per session (₹)').fill('1500');
  await page.getByLabel('Audio').check();
  for (const label of ['Qualification proof', 'Membership proof', 'Identity proof']) {
    await page.getByLabel(label).setInputFiles({ name: `${label}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }); // NOSONAR: tests run steps in order
  }
  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    category: 'CA', qualification: 'Chartered Accountant', membershipNo: 'ICAI-1234',
    expertise: ['GST', 'company law'], languages: ['English', 'Hindi'], city: 'Mumbai',
    state: 'Maharashtra', feePerSession: 150000, consultationTypes: ['AUDIO'],
    documents: { qualificationProofId: fileIds[0], membershipProofId: fileIds[1], idProofId: fileIds[2] },
  });
});
