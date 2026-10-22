import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
const adminUrl = process.env.ADMIN_BASE_URL ?? process.env.ADMIN_URL ?? 'http://localhost:3001';

const SAMPLE_PDF_BUFFER = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);

function makeRunId(suffix = ''): string {
  const rand = crypto.randomInt(100, 999);
  return `${Date.now().toString().slice(-6)}${rand}${suffix}`;
}

function hmacHex(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function base32Decode(input: string): Buffer {
  const clean = input.replaceAll(/[\s=-]/g, '').toUpperCase();
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCode(secret: string, step = Math.floor(Date.now() / 1000 / 30)): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac.at(-1)! & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1000000).padStart(6, '0');
}

interface AdminTestSession {
  userId: string;
  email: string;
  password: string;
  secret: string;
  token: string;
}

async function createAdminSession(
  request: APIRequestContext,
  runId: string,
): Promise<AdminTestSession> {
  const email = `pw-admin-${runId}@example.com`;
  const password = 'Playwright@12345'; // NOSONAR: test credential
  const mobile = `6${runId.replaceAll(/\D/g, '').padStart(9, '0').slice(-9)}`;

  execFileSync('pnpm', ['--filter', '@biznexa/api', 'create-admin'], { // NOSONAR: dev tool from PATH
    cwd: repoRoot,
    env: {
      ...process.env,
      ADMIN_NAME: `PW Admin ${runId}`,
      ADMIN_EMAIL: email,
      ADMIN_MOBILE: mobile,
      ADMIN_PASSWORD: password,
    },
    stdio: 'pipe',
  });

  const loginRes = await request.post(`${apiUrl}/api/auth/login`, {
    data: { email, password },
  });
  expect(loginRes.status()).toBe(200);
  const loginJson = (await loginRes.json()) as { accessToken: string; user: { id: string } };
  const auth = { Authorization: `Bearer ${loginJson.accessToken}` };

  const setupRes = await request.post(`${apiUrl}/api/auth/2fa/setup`, { headers: auth });
  expect(setupRes.status()).toBe(200);
  const { secret } = (await setupRes.json()) as { secret: string };

  const nowStep = Math.floor(Date.now() / 1000 / 30);
  const enableRes = await request.post(`${apiUrl}/api/auth/2fa/enable`, {
    headers: auth,
    data: { code: totpCode(secret, nowStep - 1) },
  });
  expect(enableRes.status()).toBe(200);
  const enableJson = (await enableRes.json()) as { accessToken: string };

  return {
    userId: loginJson.user.id,
    email,
    password,
    secret,
    token: enableJson.accessToken,
  };
}

interface CustomerTestSession {
  userId: string;
  name: string;
  email: string;
  mobile: string;
  password: string;
  token: string;
}

async function createCustomerSession(
  request: APIRequestContext,
  runId: string,
  index = 1,
): Promise<CustomerTestSession> {
  const digits = `${index}${runId.replaceAll(/\D/g, '').slice(-8)}`.padStart(9, '0').slice(0, 9);
  const mobile = `7${digits}`;
  const email = `pw-cust-${index}-${runId}@example.com`;
  const password = 'Customer@12345'; // NOSONAR: test credential
  const name = `PW Customer ${index} ${runId}`;

  const res = await request.post(`${apiUrl}/api/auth/register`, {
    data: { name, mobile, email, password, consent: true },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { accessToken: string; user: { id: string } };

  return {
    userId: body.user.id,
    name,
    email,
    mobile,
    password,
    token: body.accessToken,
  };
}

async function signInCustomerOnPage(page: Page, customer: Pick<CustomerTestSession, 'email' | 'password'>) {
  await page.context().clearCookies();
  await page.goto('/login');
  const status = await page.evaluate(
    async ({ email, password }) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        localStorage.setItem('bn_has_session', '1');
      }
      return res.status;
    },
    { email: customer.email, password: customer.password },
  );
  expect(status).toBe(200);
}

async function signInAdminOnPage(page: Page, admin: AdminTestSession, baseUrl = adminUrl) {
  await page.context().clearCookies();
  await page.goto(`${baseUrl}/login`);
  const nowStep = Math.floor(Date.now() / 1000 / 30);
  const codeCurrent = totpCode(admin.secret, nowStep);
  const codeNext = totpCode(admin.secret, nowStep + 1);
  const status = await page.evaluate(
    async ({ email, password, codeCurrent, codeNext }) => {
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) return loginRes.status;
      const loginBody = (await loginRes.json()) as { accessToken: string };
      let verifyRes = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${loginBody.accessToken}`,
        },
        credentials: 'include',
        body: JSON.stringify({ code: codeCurrent }),
      });
      if (!verifyRes.ok) {
        verifyRes = await fetch('/api/auth/2fa/verify', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${loginBody.accessToken}`,
          },
          credentials: 'include',
          body: JSON.stringify({ code: codeNext }),
        });
      }
      if (verifyRes.ok) {
        localStorage.setItem('bn_admin_session', '1');
      }
      return verifyRes.status;
    },
    { email: admin.email, password: admin.password, codeCurrent, codeNext },
  );
  expect(status).toBe(200);
}

interface PaidApplicationFixture {
  applicationId: string;
  applicationCode: string;
  businessEntityId: string;
  businessLegalName: string;
}

async function createPaidApplication(
  request: APIRequestContext,
  customer: CustomerTestSession,
  runId: string,
): Promise<PaidApplicationFixture> {
  const customerAuth = { Authorization: `Bearer ${customer.token}` };
  const businessLegalName = `PW Corp ${runId}`;

  const entityRes = await request.post(`${apiUrl}/api/business-entities`, {
    headers: customerAuth,
    data: {
      legalName: businessLegalName,
      entityType: 'PRIVATE_LIMITED',
    },
  });
  expect(entityRes.status()).toBe(201);
  const businessEntityId = ((await entityRes.json()) as { id: string }).id;

  const svcRes = await request.get(`${apiUrl}/api/catalogue/services/trademark-registration`);
  expect(svcRes.status()).toBe(200);
  const svcBody = (await svcRes.json()) as {
    packages: { id: string }[];
    documents: { id: string }[];
  };
  const packageId = svcBody.packages[0]!.id;

  const appRes = await request.post(`${apiUrl}/api/applications`, {
    headers: customerAuth,
    data: { packageId, businessEntityId },
  });
  expect(appRes.ok()).toBe(true);
  const appBody = (await appRes.json()) as { id: string; code: string };
  const applicationId = appBody.id;

  const formRes = await request.patch(`${apiUrl}/api/applications/${applicationId}`, {
    headers: customerAuth,
    data: {
      final: true,
      formData: {
        applicantType: 'Individual or sole proprietor',
        applicantName: `Applicant ${runId}`,
        applicantAddress: {
          line1: '123 Test Street',
          city: 'Chandigarh',
          state: 'Punjab',
          pincode: '160017',
        },
        contactEmail: customer.email,
        contactMobile: customer.mobile,
        markType: 'A word or name',
        brandName: `BRAND ${runId}`,
        goodsServices: 'Legal and business compliance consultancy',
        useStatus: 'Not yet — proposed to be used',
      },
    },
  });
  expect(formRes.status()).toBe(200);

  if (svcBody.documents.length > 0) {
    const reqId = svcBody.documents[0]!.id;
    const fileRes = await request.post(`${apiUrl}/api/files?requirementId=${reqId}`, {
      headers: customerAuth,
      multipart: {
        file: {
          name: `doc-${runId}.pdf`,
          mimeType: 'application/pdf',
          buffer: SAMPLE_PDF_BUFFER,
        },
      },
    });
    expect(fileRes.status()).toBe(201);
    const fileId = ((await fileRes.json()) as { id: string }).id;
    const attachRes = await request.post(
      `${apiUrl}/api/applications/${applicationId}/documents/${reqId}`,
      {
        headers: customerAuth,
        data: { fileId },
      },
    );
    expect(attachRes.status()).toBe(201);
  }

  const checkoutRes = await request.post(`${apiUrl}/api/applications/${applicationId}/payment`, {
    headers: customerAuth,
    data: { plan: 'FULL' },
  });
  expect(checkoutRes.status()).toBe(200);
  const checkout = (await checkoutRes.json()) as { gatewayOrderId: string; amount: number };

  const webhookPayload = JSON.stringify({
    entity: 'event',
    account_id: 'acc_mock',
    event: 'payment.captured',
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: `pay_pw_${runId}`,
          entity: 'payment',
          amount: checkout.amount,
          currency: 'INR',
          status: 'captured',
          order_id: checkout.gatewayOrderId,
          method: 'upi',
          amount_refunded: 0,
          captured: true,
          error_description: null,
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    },
    created_at: Math.floor(Date.now() / 1000),
  });
  const webhookRes = await request.post(`${apiUrl}/api/payments/webhook`, {
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': hmacHex('mock-webhook-secret', webhookPayload),
      'x-razorpay-event-id': `evt_pw_${runId}`,
    },
    data: webhookPayload,
  });
  expect(webhookRes.status()).toBe(200);

  return {
    applicationId,
    applicationCode: appBody.code,
    businessEntityId,
    businessLegalName,
  };
}

function cleanupRun(runId: string) {
  const cleanupScript = path.resolve(repoRoot, 'apps/api/test/fixtures/e2e-cleanup.ts');
  if (fs.existsSync(cleanupScript)) {
    try {
      execFileSync('pnpm', ['--filter', '@biznexa/api', 'exec', 'tsx', 'test/fixtures/e2e-cleanup.ts', runId], { // NOSONAR: dev tool from PATH
        cwd: repoRoot,
        env: process.env,
        stdio: 'pipe',
      });
    } catch {
      // ignore
    }
  }
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function checkA11y(page: Page, pageLabel: string, failures: string[]) {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .options({ rules: { 'heading-order': { enabled: true } } })
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical' || v.id === 'heading-order',
  );
  if (blocking.length > 0) {
    const details = blocking
      .map(
        (v) =>
          `[${v.impact}] ${v.id}: ${v.help}\n` +
          v.nodes.map((n) => `  - ${n.target.join(' ')}: ${n.html}\n    ${n.failureSummary}`).join('\n'),
      )
      .join('\n');
    failures.push(`=== ${pageLabel} ===\n${details}`);
  }
}

test.describe('WCAG 2.1 AA accessibility audit & keyboard/dialog interactions', () => {
  test('audits all required web and admin pages and verifies keyboard reachability and focus traps', async ({
    page,
    request,
  }, info) => {
    test.setTimeout(180_000);
    const runId = makeRunId(info.project.name === 'mobile' ? 'm' : 'd');
    const failures: string[] = [];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let admin: AdminTestSession;
    let customer: CustomerTestSession;

    try {
      admin = await createAdminSession(request, runId);
      customer = await createCustomerSession(request, runId, 1);

      const adminAuth = { Authorization: `Bearer ${admin.token}` };
      const customerAuth = { Authorization: `Bearer ${customer.token}` };

      const {
        applicationId,
        applicationCode,
        businessEntityId,
        businessLegalName,
      } = await createPaidApplication(request, customer, runId);
      const appBody = { id: applicationId, code: applicationCode };

      // Issue a certificate linked to this application & business entity
      const bodiesRes = await request.get(`${apiUrl}/api/admin/certificates/bodies`, {
        headers: adminAuth,
      });
      expect(bodiesRes.status()).toBe(200);
      const bodies = (await bodiesRes.json()) as { id: string }[];
      const certificationBodyId = bodies[0]!.id;

      const today = new Date().toISOString().slice(0, 10);
      const in20Days = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
      const certRes = await request.post(`${apiUrl}/api/admin/certificates`, {
        headers: adminAuth,
        data: {
          type: 'ISO 9001:2015',
          organizationName: businessLegalName,
          scope: 'Quality Management System',
          address: 'Sector 17, Chandigarh',
          issueDate: today,
          validFrom: today,
          validUntil: in20Days,
          certificationBodyId,
          applicationId,
          businessEntityId,
          showPdfPublicly: true,
        },
      });
      expect(certRes.status()).toBe(201);

      // Create a support ticket
      const ticketRes = await request.post(`${apiUrl}/api/tickets`, {
        headers: customerAuth,
        data: {
          subject: `A11y Support Ticket ${runId}`,
          description: 'Checking accessibility on support ticket list and detail view.',
          applicationId,
          priority: 'MEDIUM',
        },
      });
      expect(ticketRes.status()).toBe(201);

      // ─────────────────────────────────────────────────────────────────
      // 1. Web Public Pages: Home, Service Page, Login, Register
      // ─────────────────────────────────────────────────────────────────
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await checkA11y(page, 'Web Home (/)', failures);

      // Keyboard reachability of Services menu on desktop
      if (info.project.name !== 'mobile') {
        const servicesMenuBtn = page.getByRole('button', { name: 'Services', exact: true });
        await servicesMenuBtn.focus();
        await page.keyboard.press('Enter');
        await expect(servicesMenuBtn).toHaveAttribute('aria-expanded', 'true');
        await checkA11y(page, 'Web Home Services Mega-Menu Open', failures);
        await page.keyboard.press('Escape');
        await expect(servicesMenuBtn).toHaveAttribute('aria-expanded', 'false');
      }

      await page.goto('/services/tax-gst/gst-registration');
      await expect(page.getByRole('heading', { level: 1, name: 'GST Registration' })).toBeVisible();
      await checkA11y(page, 'Web Service Page (/services/tax-gst/gst-registration)', failures);

      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Log in to BizNexa' })).toBeVisible();
      await checkA11y(page, 'Web Login (/login - Email tab)', failures);
      await page.getByRole('tab', { name: 'Mobile OTP' }).click();
      await checkA11y(page, 'Web Login (/login - Mobile OTP tab)', failures);

      await page.goto('/register');
      await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
      await checkA11y(page, 'Web Register (/register)', failures);

      // ─────────────────────────────────────────────────────────────────
      // 2. Web Authenticated Pages: Dashboard, Application Detail, Documents, Payments, Certificates, Support
      // ─────────────────────────────────────────────────────────────────
      await signInCustomerOnPage(page, customer);

      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello,');
      await checkA11y(page, 'Web Dashboard Home (/dashboard)', failures);

      await page.goto(`/dashboard/applications/${applicationId}`);
      await expect(page.getByTestId('application-code')).toHaveText(appBody.code);
      await checkA11y(page, 'Web Application Detail - Documents tab', failures);
      for (const tabName of ['Form', 'Payments', 'Deliverables', 'Messages'] as const) {
        await page.getByRole('tab', { name: new RegExp(`^${tabName}`) }).click(); // NOSONAR: tests run steps in order
        await checkA11y(page, `Web Application Detail - ${tabName} tab`, failures); // NOSONAR: tests run steps in order
      }

      await page.goto('/dashboard/documents');
      await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await expect(page.getByText(appBody.code)).toBeVisible();
      await checkA11y(page, 'Web Documents (/dashboard/documents)', failures);

      await page.goto('/dashboard/payments');
      await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Payment History' })).toBeVisible();
      await checkA11y(page, 'Web Payments (/dashboard/payments)', failures);

      await page.goto('/dashboard/certificates');
      await expect(page.getByRole('heading', { level: 1, name: 'My Certificates' })).toBeVisible();
      await expect(page.getByText(businessLegalName).first()).toBeVisible();
      await checkA11y(page, 'Web Certificates (/dashboard/certificates)', failures);

      // Open QR code dialog on Certificates page, verify axe + focus trap + Escape key close
      await page.getByRole('button', { name: /View QR/i }).first().click();
      const qrDialog = page.getByRole('dialog');
      await expect(qrDialog).toBeVisible();
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab'); // NOSONAR: tests run steps in order
        const insideQrDialog = await page.evaluate(() => // NOSONAR: tests run steps in order
          Boolean(document.activeElement?.closest('dialog')),
        );
        expect(insideQrDialog).toBe(true);
      }
      await checkA11y(page, 'Web Certificates - QR Code Dialog', failures);
      await page.keyboard.press('Escape');
      await expect(qrDialog).toBeHidden();

      await page.goto('/dashboard/support');
      await expect(page.getByRole('heading', { level: 1, name: 'Support Tickets' })).toBeVisible();
      await expect(page.getByText(`A11y Support Ticket ${runId}`)).toBeVisible();
      await checkA11y(page, 'Web Support (/dashboard/support)', failures);

      // Open "Raise New Ticket" dialog, verify focus trap & Escape close
      await page.getByRole('button', { name: 'Raise New Ticket' }).click();
      const ticketDialog = page.getByRole('dialog', { name: 'Raise Support Ticket' });
      await expect(ticketDialog).toBeVisible();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab'); // NOSONAR: tests run steps in order
        const insideTicketDialog = await page.evaluate(() => // NOSONAR: tests run steps in order
          Boolean(document.activeElement?.closest('dialog')),
        );
        expect(insideTicketDialog).toBe(true);
      }
      await checkA11y(page, 'Web Support - Raise New Ticket Dialog', failures);
      await page.keyboard.press('Escape');
      await expect(ticketDialog).toBeHidden();

      // Open ticket detail view in Support
      await page.getByText(`A11y Support Ticket ${runId}`).click();
      await expect(page.getByRole('button', { name: /Back to all tickets/i })).toBeVisible();
      await checkA11y(page, 'Web Support - Ticket Detail View', failures);

      // ─────────────────────────────────────────────────────────────────
      // 3. Admin Pages: Login, Applications List/Detail, Customers, Tickets, Notifications
      // ─────────────────────────────────────────────────────────────────
      await page.goto(`${adminUrl}/login`);
      await expect(page.getByRole('heading', { level: 1, name: 'Staff login' })).toBeVisible();
      await checkA11y(page, 'Admin Login (/login)', failures);

      await signInAdminOnPage(page, admin);

      await page.goto(`${adminUrl}/applications`);
      await expect(page.getByRole('heading', { level: 1, name: 'Applications' })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Applications' })).toBeVisible();
      await checkA11y(page, 'Admin Applications List (/applications)', failures);

      await page.goto(`${adminUrl}/applications/${applicationId}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(appBody.code);
      await checkA11y(page, 'Admin Application Detail (/applications/[id])', failures);

      // Open Request Document dialog in Admin Application Detail, check axe + Esc close
      await page.getByRole('button', { name: 'Request document' }).click();
      const reqDocDialog = page.getByRole('dialog', { name: 'Request Document' });
      await expect(reqDocDialog).toBeVisible();
      await checkA11y(page, 'Admin Application Detail - Request Document Dialog', failures);
      await page.keyboard.press('Escape');
      await expect(reqDocDialog).toBeHidden();

      await page.goto(`${adminUrl}/customers`);
      await expect(page.getByRole('heading', { level: 1, name: 'Customers' })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Customers' })).toBeVisible();
      await checkA11y(page, 'Admin Customers (/customers)', failures);

      await page.goto(`${adminUrl}/support`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Support Tickets Queue' }),
      ).toBeVisible();
      await expect(page.getByText(`A11y Support Ticket ${runId}`)).toBeVisible();
      await checkA11y(page, 'Admin Tickets (/support)', failures);

      await page.getByText(`A11y Support Ticket ${runId}`).click();
      await expect(page.getByRole('button', { name: /Back to support queue/i })).toBeVisible();
      await checkA11y(page, 'Admin Tickets - Detail View', failures);

      await page.goto(`${adminUrl}/notifications`);
      await expect(page.getByRole('heading', { level: 1, name: 'Notification log' })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Notification deliveries' })).toBeVisible();
      await checkA11y(page, 'Admin Notifications - Delivery Log tab', failures);
      await page.getByRole('button', { name: 'Templates', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Notification Templates' }),
      ).toBeVisible();
      await checkA11y(page, 'Admin Notifications - Templates tab', failures);
      await page.getByRole('button', { name: 'Announcements', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Manual announcement' }),
      ).toBeVisible();
      await checkA11y(page, 'Admin Notifications - Announcements tab', failures);

      expect(failures, `\n${failures.join('\n\n')}`).toEqual([]);
    } finally {
      cleanupRun(runId);
    }
  });
});
