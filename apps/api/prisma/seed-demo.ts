/**
 * Demo business data (non-production only), so every screen of the web, admin and consultant portal has
 * something to show: customers and their businesses, orders and applications at every status (with stage
 * history, documents, notes, messages and deliverables), payments with GST invoices, consultant bookings and
 * reviews, support tickets, in-app notifications, reminders, coupons, leads, blog posts, and website content
 * (About, legal and Contact pages, homepage banners, popular services, FAQs and testimonials) from seed-demo-content.ts.
 *
 * Run after the base seed, once:
 *
 *   pnpm db:seed && pnpm --filter @biznexa/api prisma:seed-demo
 *
 * Every demo customer signs in with password Customer@12345. Runs only once: it stops when the first demo
 * customer already exists (reset the database to start again).
 */
import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  advancePayment,
  amountInWords,
  calculatePrice,
  DEFAULT_INVOICE_PREFIX,
  financialYear,
  formatApplicationCode,
  formatBookingCode,
  formatInvoiceNumber,
  formatOrderCode,
  formDataValidator,
  invoiceLines,
  invoiceOrderLine,
  OPTION_SOURCES,
  readSellerSettings,
  sameState,
  SELLER_SETTING_KEYS,
  stateName,
  type FormLeafField,
  type FormSchema,
  type InvoiceLine,
  type InvoiceTaxType,
} from '@biznexa/types';
import { PrismaClient, type ApplicationStatus, type Prisma } from '../src/generated/prisma/client';
import { encryptField } from '../src/common/encryption';
import { sealFormData } from '../src/applications/sensitive-form-data';
import { BLOG_POSTS, CMS_PAGES, HOME_FAQ, HOME_POPULAR, TESTIMONIALS } from './seed-demo-content';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || 'uploads');
const WEB = (process.env.PUBLIC_WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = 'Customer@12345'; // NOSONAR: seed credential

const now = new Date();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const daysAgo = (d: number, hour = 11) => {
  const t = new Date(now.getTime() - d * DAY);
  t.setUTCHours(hour - 5, 30, 0, 0); // `hour` o'clock IST
  // Today's hour may not have come yet: past events stay in the past.
  return d >= 0 && t > now ? new Date(now.getTime() - HOUR) : t;
};
const later = (from: Date, hours: number) => new Date(from.getTime() + hours * HOUR);
const paise = (rupees: number) => Math.round(rupees * 100);
const pick = <T>(list: readonly T[], i: number) => list[i % list.length];
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue; // NOSONAR: drops undefined

// ─────────────────────────── Demo people ───────────────────────────

const CUSTOMERS = [
  { name: 'Rajesh Kumar', state: 'PB', city: 'Ludhiana', business: { legalName: 'Kumar Textiles Private Limited', entityType: 'PRIVATE_LIMITED', gstin: '03AAKCK1234F1Z5', state: 'Punjab', pincode: '141001' } },
  { name: 'Anita Desai', state: 'MH', city: 'Pune', business: { legalName: 'Desai Foods LLP', entityType: 'LLP', gstin: '27AAJFD5678K1Z2', state: 'Maharashtra', pincode: '411001' } },
  { name: 'Vikram Singh', state: 'DL', city: 'New Delhi', business: null },
  { name: 'Pooja Iyer', state: 'KA', city: 'Bengaluru', business: { legalName: 'Iyer Tech Solutions Private Limited', entityType: 'PRIVATE_LIMITED', gstin: '29AAFCI9012M1Z8', state: 'Karnataka', pincode: '560001' } },
  { name: 'Mohit Bansal', state: 'PB', city: 'Amritsar', business: { legalName: 'Bansal Traders', entityType: 'PROPRIETORSHIP', gstin: '03AQPPB3456C1Z1', state: 'Punjab', pincode: '143001' } },
  { name: 'Sneha Reddy', state: 'TG', city: 'Hyderabad', business: null },
  { name: 'Amit Patel', state: 'GJ', city: 'Ahmedabad', business: { legalName: 'Patel Exports Private Limited', entityType: 'PRIVATE_LIMITED', gstin: '24AAGCP7890Q1Z4', state: 'Gujarat', pincode: '380001' } },
  { name: 'Kavita Joshi', state: 'RJ', city: 'Jaipur', business: null },
  { name: 'Harpreet Gill', state: 'CH', city: 'Chandigarh', business: { legalName: 'Gill Organics OPC Private Limited', entityType: 'OPC', gstin: null, state: 'Chandigarh', pincode: '160017' } },
  { name: 'Deepak Choudhary', state: 'UP', city: 'Noida', business: null },
  { name: 'Ritu Malhotra', state: 'HR', city: 'Gurugram', business: { legalName: 'Malhotra Design Studio', entityType: 'PARTNERSHIP', gstin: '06AAMFM2345R1Z6', state: 'Haryana', pincode: '122001' } },
  { name: 'Sanjay Nair', state: 'KL', city: 'Kochi', business: null },
] as const;

const STREETS = ['12, Model Town', '45, Civil Lines', '7, MG Road', '221, Sector 17', '9, Park Street', '33, Mall Road'];

/** An application to create: service slug, package index (0 Basic, 1 Standard, 2 Premium) and where it has got to. */
interface AppPlan {
  customer: number;
  service: string;
  pkg: number;
  status: ApplicationStatus;
  daysAgo: number;
  coupon?: string;
  /** Pay the advance only (packages that allow part payment). */
  advance?: boolean;
  onHoldReason?: string;
  message?: boolean;
}

const APPS: AppPlan[] = [
  { customer: 0, service: 'private-limited-company-registration', pkg: 1, status: 'DELIVERED', daysAgo: 58, message: true },
  { customer: 0, service: 'gst-registration', pkg: 0, status: 'DELIVERED', daysAgo: 52 },
  { customer: 0, service: 'trademark-registration', pkg: 1, status: 'IN_PROGRESS', daysAgo: 20, message: true },
  { customer: 1, service: 'fssai-registration', pkg: 1, status: 'DOCUMENTS_PENDING', daysAgo: 9, message: true },
  { customer: 1, service: 'gst-return-filing', pkg: 0, status: 'COMPLETED', daysAgo: 30, coupon: 'WELCOME10' },
  { customer: 2, service: 'itr-filing', pkg: 0, status: 'SUBMITTED', daysAgo: 1 },
  { customer: 2, service: 'trademark-registration', pkg: 0, status: 'DRAFT', daysAgo: 0 },
  { customer: 3, service: 'iso-9001-certification', pkg: 2, status: 'DELIVERED', daysAgo: 45, message: true },
  { customer: 3, service: 'website-development', pkg: 1, status: 'IN_PROGRESS', daysAgo: 14, advance: true },
  { customer: 4, service: 'msme-udyam-registration', pkg: 0, status: 'DOCUMENTS_UNDER_REVIEW', daysAgo: 3 },
  { customer: 4, service: 'gst-registration', pkg: 1, status: 'PAYMENT_PENDING', daysAgo: 2 },
  { customer: 5, service: 'llp-registration', pkg: 1, status: 'ASSIGNED', daysAgo: 6, coupon: 'FLAT500' },
  { customer: 5, service: 'itr-filing', pkg: 1, status: 'CANCELLED', daysAgo: 25 },
  { customer: 6, service: 'import-export-code', pkg: 0, status: 'DOCUMENTS_APPROVED', daysAgo: 5 },
  { customer: 6, service: 'iso-14001-certification', pkg: 1, status: 'ON_HOLD', daysAgo: 18, onHoldReason: 'Waiting for the site audit date from the certification body' },
  { customer: 7, service: 'gst-registration', pkg: 0, status: 'IN_PROGRESS', daysAgo: 8 },
  { customer: 8, service: 'opc-registration', pkg: 1, status: 'COMPLETED', daysAgo: 22 },
  { customer: 8, service: 'fssai-registration', pkg: 0, status: 'SUBMITTED', daysAgo: 0 },
  { customer: 9, service: 'trademark-registration', pkg: 2, status: 'DOCUMENTS_UNDER_REVIEW', daysAgo: 4 },
  { customer: 10, service: 'partnership-registration', pkg: 0, status: 'DELIVERED', daysAgo: 40 },
  { customer: 10, service: 'gst-return-filing', pkg: 1, status: 'ASSIGNED', daysAgo: 2 },
  { customer: 11, service: 'private-limited-company-registration', pkg: 0, status: 'PAYMENT_PENDING', daysAgo: 1 },
  { customer: 11, service: 'msme-udyam-registration', pkg: 0, status: 'DELIVERED', daysAgo: 35, coupon: 'WELCOME10' },
];

/** The statuses an application passes through to reach `status`, after DRAFT. */
function pathTo(status: ApplicationStatus): ApplicationStatus[] {
  const paid: ApplicationStatus[] = ['PAYMENT_PENDING', 'SUBMITTED'];
  switch (status) {
    case 'DRAFT': return [];
    case 'PAYMENT_PENDING': return ['PAYMENT_PENDING'];
    case 'CANCELLED': return ['PAYMENT_PENDING', 'CANCELLED'];
    case 'DOCUMENTS_PENDING': return [...paid, 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_PENDING'];
    case 'ON_HOLD': return [...paid, 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'];
    default: {
      const flow: ApplicationStatus[] = [...paid, 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED'];
      return flow.slice(0, flow.indexOf(status) + 1);
    }
  }
}

const NOTES: Partial<Record<ApplicationStatus, string>> = {
  PAYMENT_PENDING: 'Waiting for payment',
  SUBMITTED: 'Payment received. Your application has been submitted.',
  DOCUMENTS_UNDER_REVIEW: 'Our team is checking your documents.',
  DOCUMENTS_PENDING: 'Some documents need to be uploaded again.',
  DOCUMENTS_APPROVED: 'All documents are approved.',
  ASSIGNED: 'An expert has been assigned to your application.',
  IN_PROGRESS: 'Work on your application has started.',
  COMPLETED: 'Your application is complete. Final documents are being prepared.',
  DELIVERED: 'Final documents are ready to download.',
  CANCELLED: 'Cancelled because the payment was not completed.',
};

const PAID_STATUSES = new Set<ApplicationStatus>(['SUBMITTED', 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_PENDING', 'DOCUMENTS_APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'DELIVERED']);
const DOCS_APPROVED = new Set<ApplicationStatus>(['DOCUMENTS_APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'DELIVERED']);
const WORKED_ON = new Set<ApplicationStatus>(['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'DELIVERED']);
const PAY_METHODS = ['upi', 'card', 'netbanking', 'upi'];

// ─────────────────────────── Files ───────────────────────────

/** A one-page PDF saying `text`, so previews and downloads work. */
function samplePdf(text: string): Buffer {
  const safe = text.replaceAll(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 72 720 Td (${safe}) Tj 0 -28 Td /F1 11 Tf (BizNexa demo file - sample data, not a real document) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Writes a sample PDF to private storage and records it as a clean upload. */
async function storeFile(ownerId: string, name: string, at: Date, requirementId: string | null = null) {
  const hex = randomBytes(16).toString('hex');
  const fileKey = `${hex.slice(0, 2)}/${hex}`;
  const bytes = samplePdf(name.replace(/\.pdf$/, ''));
  const path = join(UPLOAD_DIR, fileKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return prisma.storedFile.create({
    data: {
      fileKey, ownerId, originalName: name, mimeType: 'application/pdf', sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), requirementId, scanStatus: 'CLEAN', scannedAt: at, createdAt: at,
    },
  });
}

// ─────────────────────────── Form answers ───────────────────────────

/** Plausible answers for every field of a form; the form's own validator keeps only valid ones. */
function fakeAnswers(form: FormSchema, who: { name: string; email: string; mobile: string; city: string; state: string }, i: number): Record<string, unknown> {
  const value = (f: FormLeafField): unknown => {
    const n = f.name.toLowerCase();
    switch (f.type) {
      case 'email': return who.email;
      case 'tel': return f.pattern?.startsWith(String.raw`\d{9`) ? '50100234567890' : who.mobile;
      case 'number': return f.min != null && f.min > 0 ? f.min : (n.includes('capital') ? 100000 : 2);
      case 'date': return n.includes('birth') ? '1988-06-15' : daysAgo(400 + i).toISOString().slice(0, 10);
      case 'select': return f.options?.[0]?.value ?? (f.optionsSource ? OPTION_SOURCES[f.optionsSource][0] : undefined);
      case 'multi-select': return f.options?.length ? [f.options[0].value] : undefined;
      case 'address': return { line1: pick(STREETS, i), city: who.city, state: stateName(who.state) ?? 'Punjab', pincode: '141001' };
      case 'file': return undefined;
      case 'textarea': return `Demo details for ${f.label.toLowerCase()} (sample data).`;
      default: break;
    }
    if (f.pattern) {
      const samples = ['ABCPK1234F', '03ABCPK1234F1Z5', 'U74999PB2020PTC012345', '01234567', '9876501234', 'HDFC0001234', '50100234567890', '12345678901234'];
      return samples.find((s) => new RegExp(`^(?:${f.pattern})$`).test(s));
    }
    if (n.includes('name')) return n.includes('business') || n.includes('company') || n.includes('brand') ? `${who.name.split(' ')[1]} Enterprises` : who.name;
    if (n.includes('city')) return who.city;
    if (n.includes('pin')) return '141001';
    return 'Sample answer';
  };
  const data: Record<string, unknown> = {};
  for (const f of form.steps.flatMap((s) => s.fields)) {
    if (f.type === 'repeater') {
      const row = Object.fromEntries(f.fields.map((sub) => [sub.name, value(sub)]));
      data[f.name] = Array.from({ length: Math.max(f.minItems ?? 1, 1) }, () => row);
    } else {
      data[f.name] = value(f);
    }
  }
  const parsed = formDataValidator(form, { partial: true }).safeParse(data);
  return parsed.success ? parsed.data : {};
}

// ─────────────────────────── Seed steps ───────────────────────────

async function seedCustomers() {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'CUSTOMER' } });
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const out = [];
  for (const [i, c] of CUSTOMERS.entries()) {
    const email = `${c.name.toLowerCase().replace(' ', '.')}@demo.biznexa.local`;
    const mobile = `98100${String(10001 + i).slice(-5)}`;
    const createdAt = daysAgo(70 - i * 3);
    const user = await prisma.user.create({ // NOSONAR: seed writes run in order
      data: {
        name: c.name, email, mobile, passwordHash, emailVerified: true, mobileVerified: true, consentAt: createdAt,
        createdAt, lastLoginAt: daysAgo(i % 5),
        roles: { create: { roleId: role.id } },
        customerProfile: { create: { address: pick(STREETS, i), city: c.city, state: c.state, pincode: c.business?.pincode ?? '110001' } },
      },
    });
    const business = c.business
      ? await prisma.businessEntity.create({ // NOSONAR: seed writes run in order
          data: {
            ownerId: user.id, legalName: c.business.legalName, entityType: c.business.entityType, gstin: c.business.gstin,
            pan: c.business.gstin ? encryptField(c.business.gstin.slice(2, 12)) : null, state: c.business.state, createdAt,
            address: { line1: pick(STREETS, i), city: c.city, state: c.business.state, pincode: c.business.pincode },
          },
        })
      : null;
    out.push({ ...c, user, email, mobile, business });
  }
  console.log(`✓ ${out.length} demo customers (password ${PASSWORD}), ${out.filter((c) => c.business).length} businesses`);
  return out;
}

async function seedCoupons() {
  const welcome = await prisma.coupon.upsert({
    where: { code: 'WELCOME10' }, update: {},
    create: { code: 'WELCOME10', type: 'PERCENTAGE', value: 10, maxDiscount: paise(1000), startsAt: daysAgo(90), expiresAt: daysAgo(-90), usageLimit: 500 },
  });
  const flat = await prisma.coupon.upsert({
    where: { code: 'FLAT500' }, update: {},
    create: { code: 'FLAT500', type: 'FIXED', value: paise(500), minOrderValue: paise(3000), startsAt: daysAgo(60), expiresAt: daysAgo(-30), usageLimit: 100 },
  });
  await prisma.coupon.upsert({
    where: { code: 'DIWALI25' }, update: {},
    create: { code: 'DIWALI25', type: 'PERCENTAGE', value: 25, maxDiscount: paise(2500), startsAt: daysAgo(-5), expiresAt: daysAgo(-20), usageLimit: 200 },
  });
  await prisma.coupon.upsert({
    where: { code: 'MONSOON15' }, update: {},
    create: { code: 'MONSOON15', type: 'PERCENTAGE', value: 15, startsAt: daysAgo(120), expiresAt: daysAgo(40), isActive: false },
  });
  console.log('✓ 4 coupons (WELCOME10, FLAT500, DIWALI25 upcoming, MONSOON15 expired)');
  return { WELCOME10: welcome, FLAT500: flat } as Record<string, typeof welcome>;
}

/** Issues the invoice for a successful order payment, exactly as `InvoicesService` does. */
async function issueInvoice(tx: Prisma.TransactionClient, paymentId: string, at: Date) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amount: true, orderId: true } });
  const order = await tx.order.findUniqueOrThrow({
    where: { id: payment.orderId! },
    select: {
      id: true, customerId: true, buyerState: true,
      items: { orderBy: { id: 'asc' }, select: { id: true, description: true, sacCode: true, professionalFee: true, governmentFee: true, discount: true, gstRate: true } },
      invoices: { orderBy: { issuedAt: 'asc' }, select: { lines: true, taxType: true, placeOfSupply: true } },
      customer: { select: { name: true, email: true, mobile: true, customerProfile: { select: { address: true, city: true, state: true, pincode: true } } } },
      applications: { take: 1, select: { businessEntity: { select: { legalName: true, gstin: true, address: true, state: true } } } },
    },
  });
  const rows = await tx.setting.findMany({ where: { key: { in: Object.values(SELLER_SETTING_KEYS) } }, select: { key: true, value: true } });
  const s = readSellerSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  const seller = { name: s.name, legalName: s.legalName, gstin: s.gstin, email: s.email, phone: s.phone, address: s.address, state: s.state };
  const first = order.invoices[0];
  const placeOfSupply = first ? first.placeOfSupply : (stateName(order.buyerState) ?? seller.state);
  const taxType: InvoiceTaxType = first ? (first.taxType as InvoiceTaxType) : (seller.state && placeOfSupply && sameState(seller.state, placeOfSupply) ? 'CGST_SGST' : 'IGST');
  const lines = order.items.map((i) => invoiceOrderLine(i, taxType));
  const amounts = invoiceLines(lines, order.invoices.flatMap((i) => i.lines as unknown as InvoiceLine[]), payment.amount, taxType);

  const business = order.applications[0]?.businessEntity;
  const contact = { email: order.customer.email, mobile: order.customer.mobile };
  const p = order.customer.customerProfile;
  const buyer = business
    ? { name: business.legalName, gstin: business.gstin, ...contact, address: business.address, state: stateName(business.state) }
    : { name: order.customer.name, gstin: null, ...contact, address: p?.address && p.city && p.state && p.pincode ? { line1: p.address, city: p.city, state: stateName(p.state), pincode: p.pincode } : null, state: stateName(p?.state) };

  const fy = financialYear(at);
  const [row] = await tx.$queryRaw<{ lastNumber: number }[]>`
    INSERT INTO "InvoiceSequence" ("financialYear", "lastNumber", "updatedAt") VALUES (${fy}, 1, now())
    ON CONFLICT ("financialYear") DO UPDATE SET "lastNumber" = "InvoiceSequence"."lastNumber" + 1, "updatedAt" = now()
    RETURNING "lastNumber"`;
  const sequence = Number(row.lastNumber);
  await tx.invoice.create({
    data: {
      number: formatInvoiceNumber(s.invoicePrefix ?? DEFAULT_INVOICE_PREFIX, fy, sequence), financialYear: fy, sequence, issuedAt: at, createdAt: at,
      orderId: order.id, paymentId, customerId: order.customerId, sellerGstin: seller.gstin, seller: json(seller),
      buyerName: buyer.name, buyerGstin: buyer.gstin, buyer: json(buyer), placeOfSupply, taxType, lines: json(amounts.lines),
      taxableValue: amounts.taxableValue, cgst: amounts.cgst, sgst: amounts.sgst, igst: amounts.igst, govtFees: amounts.govtFees,
      discount: amounts.discount, total: amounts.total, amountInWords: amountInWords(amounts.total),
    },
  });
}

/** A captured payment, the webhook event that applied it, and its invoice when it paid for an order. */
async function successfulPayment(data: { orderId?: string; bookingId?: string; amount: number; at: Date; method: string }) {
  return prisma.$transaction(async (tx) => {
    const ref = randomBytes(7).toString('hex');
    const payment = await tx.payment.create({
      data: {
        orderId: data.orderId, bookingId: data.bookingId, gateway: 'MOCK', gatewayOrderId: `order_demo${ref}`, gatewayPaymentId: `pay_demo${ref}`,
        amount: data.amount, method: data.method, status: 'SUCCESS', paidAt: data.at, createdAt: later(data.at, -0.1),
      },
    });
    await tx.paymentWebhookEvent.create({
      data: {
        gateway: 'MOCK', eventId: `evt_demo${ref}`, event: 'payment.captured', gatewayPaymentId: payment.gatewayPaymentId, paymentId: payment.id,
        payload: { demo: true, payment: { id: payment.gatewayPaymentId, amount: data.amount, method: data.method } }, outcome: 'applied', receivedAt: data.at,
      },
    });
    if (data.orderId) await issueInvoice(tx, payment.id, data.at);
    return payment;
  });
}

type Customer = Awaited<ReturnType<typeof seedCustomers>>[number];
type Staff = Record<'admin' | 'ops' | 'support' | 'consultant', { id: string; name: string }>;

async function seedApplications(customers: Customer[], coupons: Record<string, { id: string; type: 'PERCENTAGE' | 'FIXED'; value: number; maxDiscount: number | null }>, staff: Staff) {
  let invoices = 0;
  // Oldest first, so codes and gap-free invoice numbers follow the dates.
  const plans = [...APPS].sort((a, b) => b.daysAgo - a.daysAgo);
  for (const [i, plan] of plans.entries()) {
    const c = customers[plan.customer];
    const service = await prisma.service.findUnique({ // NOSONAR: seed writes run in order
      where: { slug: plan.service },
      include: { packages: { orderBy: { sortOrder: 'asc' } }, stages: { orderBy: { sortOrder: 'asc' } }, documents: { orderBy: { sortOrder: 'asc' } }, formSchemas: { where: { isCurrent: true }, take: 1 } },
    });
    if (!service) {
      console.warn(`  ! service ${plan.service} not found, skipped`);
      continue;
    }
    const pkg = service.packages[plan.pkg] ?? service.packages[0];
    const form = service.formSchemas[0];
    const created = new Date(Math.min(daysAgo(plan.daysAgo, 10 + (i % 6)).getTime(), now.getTime() - 3 * HOUR));

    const coupon = plan.coupon ? coupons[plan.coupon] : undefined;
    let discount = 0;
    if (coupon) discount = coupon.type === 'FIXED' ? coupon.value : Math.min(Math.round((pkg.professionalFee * coupon.value) / 100), coupon.maxDiscount ?? Infinity);
    const price = calculatePrice({ professionalFee: pkg.professionalFee, governmentFee: pkg.governmentFee, gstRate: pkg.gstRate, discount });
    const advance = plan.advance ? advancePayment([{ total: price.total, governmentFee: price.governmentFee, advancePercent: pkg.advancePercent }]) : null;

    const path = pathTo(plan.status);
    const paid = path.some((s) => PAID_STATUSES.has(s));
    let orderStatus: 'CREATED' | 'PAYMENT_PENDING' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELLED' = 'CREATED';
    if (plan.status === 'CANCELLED') orderStatus = 'CANCELLED';
    else if (paid) orderStatus = advance ? 'PARTIALLY_PAID' : 'PAID';
    else if (plan.status === 'PAYMENT_PENDING') orderStatus = 'PAYMENT_PENDING';

    const [{ order_no, application_no }] = await prisma.$queryRaw<{ order_no: bigint; application_no: bigint }[]>`
      SELECT nextval('order_code_seq') AS order_no, nextval('application_code_seq') AS application_no`;
    const business = c.business && i % 4 !== 3 ? c.business : null;
    const order = await prisma.order.create({ // NOSONAR: seed writes run in order
      data: {
        code: formatOrderCode(Number(order_no), created), customerId: c.user.id, subtotal: price.professionalFee, discount: price.discount,
        taxTotal: price.totalTax, govtFees: price.governmentFee, total: price.total, amountPaid: paid ? (advance?.amount ?? price.total) : 0,
        couponId: coupon?.id, buyerState: business?.state ?? c.state, status: orderStatus, createdAt: created,
        items: { create: { packageId: pkg.id, description: `${service.name} — ${pkg.name}`, sacCode: service.sacCode, professionalFee: pkg.professionalFee, governmentFee: pkg.governmentFee, discount: price.discount, gstRate: pkg.gstRate, advancePercent: pkg.advancePercent } },
      },
    });
    if (coupon && paid) {
      await prisma.couponRedemption.create({ data: { couponId: coupon.id, userId: c.user.id, orderId: order.id, amount: price.discount, createdAt: created } }); // NOSONAR
      await prisma.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } }); // NOSONAR
    }

    // Timeline: checkout and payment within the first hour, later steps spread up to today, never in the future.
    const span = Math.max(plan.daysAgo * DAY - 2 * HOUR, HOUR);
    const at = (step: number) =>
      new Date(created.getTime() + (step <= 2 ? step * 20 * 60_000 : HOUR + Math.min(span - HOUR, ((step - 2) * (span - HOUR)) / Math.max(path.length - 2, 1))));
    const finalStatus = plan.status;
    const assignee = WORKED_ON.has(finalStatus) ? (i % 3 === 0 ? staff.consultant : staff.ops) : null;
    const stageAt = (s: ApplicationStatus) => {
      if (!service.stages.length) return null;
      const order: ApplicationStatus[] = ['SUBMITTED', 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED'];
      const k = order.indexOf(s);
      if (k < 0) return null;
      return service.stages[Math.min(service.stages.length - 1, Math.floor((k / (order.length - 1)) * (service.stages.length - 1)))].id;
    };
    const lastWorkStatus = [...path].reverse().find((s) => stageAt(s));
    const submittedIdx = path.indexOf('SUBMITTED');

    const app = await prisma.application.create({ // NOSONAR: seed writes run in order
      data: {
        code: formatApplicationCode(Number(application_no)), orderId: order.id, customerId: c.user.id, serviceId: service.id, packageId: pkg.id,
        businessEntityId: business?.id, formSchemaVersion: form?.version,
        formData: form ? json(sealFormData(form.schema as unknown as FormSchema, fakeAnswers(form.schema as unknown as FormSchema, { name: c.name, email: c.email, mobile: c.mobile, city: c.city, state: c.state }, i))) : {},
        currentStageId: lastWorkStatus ? stageAt(lastWorkStatus) : null, status: finalStatus, assignedToId: assignee?.id,
        priority: pick(['MEDIUM', 'HIGH', 'MEDIUM', 'LOW', 'URGENT'] as const, i),
        submittedAt: submittedIdx >= 0 ? at(submittedIdx + 1) : null,
        slaDueAt: submittedIdx >= 0 ? new Date(at(submittedIdx + 1).getTime() + (service.estimatedDaysMax ?? 7) * DAY) : null,
        completedAt: finalStatus === 'COMPLETED' || finalStatus === 'DELIVERED' ? at(path.indexOf('COMPLETED') + 1) : null,
        createdAt: created, updatedAt: at(path.length),
        history: {
          create: [
            { status: 'DRAFT', changedById: c.user.id, note: 'Application started', changedAt: created },
            ...path.map((s, k) => ({
              status: s, stageId: stageAt(s), changedAt: at(k + 1),
              changedById: s === 'PAYMENT_PENDING' || s === 'SUBMITTED' ? c.user.id : (assignee ?? staff.ops).id,
              note: s === 'ON_HOLD' ? plan.onHoldReason : NOTES[s],
            })),
          ],
        },
      },
    });

    if (plan.status === 'PAYMENT_PENDING' || plan.status === 'CANCELLED') {
      const ref = randomBytes(7).toString('hex');
      await prisma.payment.create({ // NOSONAR: seed writes run in order
        data: {
          orderId: order.id, gateway: 'MOCK', gatewayOrderId: `order_demo${ref}`, amount: price.total, createdAt: at(1),
          ...(plan.status === 'CANCELLED' ? { status: 'FAILED', method: 'card', failureReason: 'Payment declined by the bank', gatewayPaymentId: `pay_demo${ref}` } : { status: 'CREATED' }),
        },
      });
    }
    if (paid) {
      await successfulPayment({ orderId: order.id, amount: advance?.amount ?? price.total, at: at(submittedIdx + 1), method: pick(PAY_METHODS, i) }); // NOSONAR
      invoices++;
    }

    await seedDocuments(app.id, plan.status, c.user.id, service.documents, at(submittedIdx + 1), staff);
    await seedWork(app.id, plan, c, assignee, staff, at, path.length, service.name);
    await seedAppNotifications(c.user.id, app.id, app.code, service.name, path, at);
    if (plan.status === 'DELIVERED') await seedOutcomes(app.id, c, business, service, at(path.length));
  }
  console.log(`✓ ${APPS.length} applications across every status, ${invoices} invoices`);
}

async function seedDocuments(
  applicationId: string, status: ApplicationStatus, customerId: string,
  requirements: { id: string; name: string; isMandatory: boolean }[], uploadedAt: Date, staff: Staff,
) {
  if (!PAID_STATUSES.has(status)) return;
  const docs = requirements.filter((r) => r.isMandatory).slice(0, 5);
  for (const [k, r] of docs.entries()) {
    const reviewedAt = later(uploadedAt, 20);
    const file = await storeFile(customerId, `${r.name.replaceAll(/[^\w]+/g, '-').toLowerCase().slice(0, 50)}.pdf`, uploadedAt, r.id); // NOSONAR
    const base = { applicationId, requirementId: r.id, name: r.name, fileKey: file.fileKey, fileName: file.originalName, mimeType: 'application/pdf', sizeBytes: file.sizeBytes, uploadedAt, createdAt: uploadedAt };
    if (status === 'DOCUMENTS_PENDING' && k === 0) {
      // First version rejected, a new upload still required.
      await prisma.applicationDocument.create({ data: { ...base, version: 1, isLatest: false, status: 'REJECTED', rejectionReason: 'The image is blurred. Upload a clear scan of all pages.', reviewedById: staff.ops.id, reviewedAt } }); // NOSONAR
      await prisma.applicationDocument.create({ data: { applicationId, requirementId: r.id, name: r.name, version: 2, status: 'REQUIRED', createdAt: reviewedAt } }); // NOSONAR
      continue;
    }
    let docStatus: 'UPLOADED' | 'UNDER_REVIEW' | 'APPROVED' = 'UPLOADED';
    if (DOCS_APPROVED.has(status) || status === 'DOCUMENTS_PENDING') docStatus = 'APPROVED';
    else if (status === 'DOCUMENTS_UNDER_REVIEW') docStatus = k % 2 ? 'APPROVED' : 'UNDER_REVIEW';
    await prisma.applicationDocument.create({ // NOSONAR: seed writes run in order
      data: { ...base, status: docStatus, ...(docStatus === 'APPROVED' ? { reviewedById: staff.ops.id, reviewedAt } : {}) },
    });
  }
}

/** Internal notes and the customer ↔ team conversation. */
async function seedWork(
  applicationId: string, plan: AppPlan, c: Customer, assignee: { id: string } | null, staff: Staff,
  at: (step: number) => Date, steps: number, serviceName: string,
) {
  if (assignee) {
    await prisma.internalNote.createMany({ // NOSONAR: seed writes run in order
      data: [
        { applicationId, authorId: staff.ops.id, body: 'Documents verified against the checklist. Assigning for filing.', createdAt: at(steps - 1) },
        { applicationId, authorId: assignee.id, body: plan.onHoldReason ? `On hold: ${plan.onHoldReason}. Follow up in 3 days.` : 'Customer confirmed details on call. Proceeding.', createdAt: at(steps) },
      ],
    });
  }
  if (!plan.message) return;
  const team = assignee ?? staff.ops;
  await prisma.conversation.create({ // NOSONAR: seed writes run in order
    data: {
      applicationId, createdAt: at(1),
      messages: {
        create: [
          { senderId: c.user.id, body: `Hi, how long will the ${serviceName} take? I need it urgently for a bank account.`, createdAt: at(1), readAt: at(1.2) },
          { senderId: team.id, body: 'Hello! We have started on it. Most cases finish within the estimated time shown on your dashboard. We will update you at every step.', createdAt: at(1.3), readAt: at(1.5) },
          { senderId: c.user.id, body: 'Thank you. Do you need anything else from me?', createdAt: at(1.6), readAt: at(1.8) },
          { senderId: team.id, body: plan.status === 'DOCUMENTS_PENDING' ? 'Please upload a clearer copy of the rejected document. Everything else looks good.' : 'Nothing more for now. We will message you here if we need anything.', createdAt: at(2) },
        ],
      },
    },
  });
}

async function seedAppNotifications(userId: string, applicationId: string, code: string, serviceName: string, path: ApplicationStatus[], at: (step: number) => Date) {
  const link = `${WEB}/dashboard/applications/${applicationId}`;
  const rows = path
    .map((s, k) => ({ s, k }))
    .filter(({ s }) => s !== 'PAYMENT_PENDING')
    .map(({ s, k }) => ({
      userId, channel: 'IN_APP' as const, event: s === 'SUBMITTED' ? 'payment.succeeded' : 'application.status_changed',
      title: s === 'SUBMITTED' ? `Payment received for ${code}` : `${code}: ${s.replaceAll('_', ' ').toLowerCase()}`,
      body: `${serviceName} — ${NOTES[s] ?? 'Status updated.'}`, link, status: 'SENT' as const, createdAt: at(k + 1),
      // Older ones read, the latest two unread.
      readAt: k < path.length - 2 ? later(at(k + 1), 3) : null,
    }));
  if (rows.length) await prisma.notification.createMany({ data: rows });
}

/** What a delivered application leaves behind: final documents, and a certificate or a renewal reminder. */
async function seedOutcomes(
  applicationId: string, c: Customer, business: { id: string; legalName: string } | null,
  service: { slug: string; name: string; recurrence: string | null }, at: Date,
) {
  const titles = service.slug.includes('company') || service.slug.includes('llp') || service.slug.includes('firm')
    ? ['Certificate of Incorporation', 'PAN and TAN allotment letter']
    : [`${service.name} certificate`];
  for (const title of titles) {
    const file = await storeFile(c.user.id, `${title.replaceAll(/[^\w]+/g, '-').toLowerCase()}.pdf`, at); // NOSONAR
    await prisma.finalDeliverable.create({ data: { applicationId, title, fileKey: file.fileKey, fileName: file.originalName, uploadedById: c.user.id, createdAt: at } }); // NOSONAR
  }
  if (service.slug.startsWith('iso-')) {
    const body = await prisma.certificationBody.findFirstOrThrow();
    const n = await prisma.certificate.count();
    await prisma.certificate.create({
      data: {
        certificateNumber: `BNC-${now.getFullYear()}-${String(n + 1).padStart(6, '0')}`, verificationId: randomBytes(6).toString('hex').toUpperCase(),
        type: 'ISO 9001:2015 — Quality Management System', organizationName: business?.legalName ?? c.name,
        scope: 'Design, development and support of software services', address: `${pick(STREETS, 2)}, ${c.city}`,
        issueDate: at, validFrom: at, validUntil: new Date(at.getTime() + 3 * 365 * DAY), certificationBodyId: body.id, status: 'ACTIVE',
        applicationId, businessEntityId: business?.id,
      },
    });
  }
  if (service.slug === 'gst-registration' || service.recurrence) {
    await prisma.reminder.create({
      data: {
        userId: c.user.id, businessEntityId: business?.id, type: 'GST_RETURN', title: 'GSTR-3B return due', dueDate: daysAgo(-12),
        renewServiceSlug: 'gst-return-filing', sourceApplicationId: applicationId, sourceKey: `application:${applicationId}`, sentOffsets: [30, 15],
      },
    });
  }
}

async function seedBookings(customers: Customer[], staff: Staff) {
  const consultants = await prisma.consultant.findMany({ where: { verificationStatus: 'APPROVED' }, orderBy: { createdAt: 'asc' } });
  if (!consultants.length) {
    console.warn('  ! no approved consultants — run pnpm db:seed first');
    return;
  }
  /** IST weekday slot: `dayOffset` days from today (moved off Sunday), at `hour`:00 IST. */
  const slot = (dayOffset: number, hour: number) => {
    const d = daysAgo(-dayOffset, hour);
    if (new Date(d.getTime() + 5.5 * HOUR).getUTCDay() === 0) d.setTime(d.getTime() + DAY);
    return d;
  };
  const plans = [
    { status: 'COMPLETED', day: -20, rating: 5, text: 'Very clear advice on GST for my new shop. Saved me a lot of time.' },
    { status: 'COMPLETED', day: -15, rating: 4, text: 'Helpful session, answered all my questions about company registration.' },
    { status: 'COMPLETED', day: -10, rating: 5, text: 'Explained the trademark objection reply step by step. Recommended!' },
    { status: 'COMPLETED', day: -6, rating: 3, text: 'Good, but the call started 10 minutes late.', pending: true },
    { status: 'COMPLETED', day: -4 },
    { status: 'NO_SHOW', day: -3 },
    { status: 'CANCELLED', day: -2 },
    { status: 'CONFIRMED', day: 1 },
    { status: 'CONFIRMED', day: 2 },
    { status: 'CONFIRMED', day: 4 },
    { status: 'EXPIRED', day: 3 },
  ] as const;
  for (const [i, p] of plans.entries()) {
    const consultant = consultants[i % consultants.length];
    const customer = customers[(i * 5) % customers.length];
    const startAt = slot(p.day, 10 + (i % 6));
    const createdAt = p.day < 0 ? later(startAt, -72) : daysAgo(1, 9 + i);
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('booking_code_seq') AS n`; // NOSONAR
    const type = consultant.consultationTypes[i % consultant.consultationTypes.length];
    const confirmed = p.status !== 'EXPIRED';
    const booking = await prisma.booking.create({ // NOSONAR: seed writes run in order
      data: {
        code: formatBookingCode(Number(n), createdAt), customerId: customer.user.id, consultantId: consultant.id, type, startAt,
        endAt: later(startAt, consultant.sessionMinutes / 60), fee: consultant.feePerSession, status: p.status, createdAt,
        holdExpiresAt: p.status === 'EXPIRED' ? later(createdAt, 10 / 60) : null,
        meetingLink: confirmed ? `https://meet.jit.si/BizNexa-${randomUUID()}` : null, // as BookingPaymentsService sets it
        notes: i % 2 ? 'Want to discuss GST registration for my new business.' : 'Need advice on choosing between LLP and Private Limited.',
        history: {
          create: [
            { fromStatus: 'PENDING_PAYMENT', toStatus: confirmed ? 'CONFIRMED' : 'EXPIRED', reason: confirmed ? 'Payment received' : 'Hold expired before payment', createdAt: later(createdAt, 0.1) },
            ...(p.status === 'CONFIRMED' || !confirmed ? [] : [{ fromStatus: 'CONFIRMED' as const, toStatus: p.status, actorId: p.status === 'CANCELLED' ? customer.user.id : consultant.userId, reason: p.status === 'CANCELLED' ? 'Customer cancelled: plans changed' : null, createdAt: later(startAt, 1) }]),
          ],
        },
      },
    });
    if (confirmed) await successfulPayment({ bookingId: booking.id, amount: booking.fee, at: later(createdAt, 0.1), method: pick(PAY_METHODS, i) });
    if (p.status === 'COMPLETED' && 'rating' in p) {
      const pending = 'pending' in p;
      await prisma.review.create({ // NOSONAR: seed writes run in order
        data: {
          bookingId: booking.id, consultantId: consultant.id, rating: p.rating, text: p.text, createdAt: later(startAt, 3),
          status: pending ? 'PENDING' : 'APPROVED', isPublished: !pending, moderatedAt: pending ? null : later(startAt, 20), moderatedById: pending ? null : staff.admin.id,
        },
      });
    }
    if (type === 'CHAT' && confirmed) {
      await prisma.conversation.create({ // NOSONAR: seed writes run in order
        data: {
          bookingId: booking.id, createdAt: startAt,
          messages: { create: [
            { senderId: customer.user.id, body: 'Hello, I have a few questions about my business registration.', createdAt: startAt },
            { senderId: consultant.userId, body: 'Sure, go ahead. Tell me about your business first.', createdAt: later(startAt, 0.05) },
          ] },
        },
      });
    }
  }
  // The listing's rating and count come from approved reviews.
  for (const c of consultants) {
    const agg = await prisma.review.aggregate({ where: { consultantId: c.id, status: 'APPROVED' }, _avg: { rating: true }, _count: true }); // NOSONAR
    if (agg._count) await prisma.consultant.update({ where: { id: c.id }, data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, reviewCount: agg._count } }); // NOSONAR
  }
  // One consultant waiting for approval, so the verification queue has an entry.
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'CONSULTANT' } });
  await prisma.user.create({
    data: {
      name: 'Manish Arora', email: 'manish.applicant@demo.biznexa.local', mobile: '9810020001', passwordHash: await bcrypt.hash('Consultant@12345', 12), // NOSONAR: seed credential
      emailVerified: true, mobileVerified: true, consentAt: daysAgo(2), roles: { create: { roleId: role.id } },
      consultant: { create: { slug: 'manish-arora', category: 'BUSINESS_CONSULTANT', qualification: 'MBA (Finance)', experienceYears: 4, expertise: ['Business Plans', 'Startup Funding'], languages: ['English', 'Hindi'], city: 'Lucknow', state: 'Uttar Pradesh', feePerSession: paise(349), consultationTypes: ['VIDEO', 'CHAT'], createdAt: daysAgo(2) } },
    },
  });
  console.log(`✓ ${plans.length} consultation bookings with payments and reviews (1 review awaiting moderation), 1 consultant awaiting approval`);
}

async function seedTickets(customers: Customer[], staff: Staff) {
  const apps = await prisma.application.findMany({ select: { id: true, customerId: true }, orderBy: { createdAt: 'asc' } });
  const tickets = [
    { subject: 'Payment deducted but order shows pending', status: 'OPEN', priority: 'URGENT', day: 0.2 },
    { subject: 'How do I download my GST certificate?', status: 'RESOLVED', priority: 'LOW', day: 12 },
    { subject: 'Need to change director name in my application', status: 'IN_PROGRESS', priority: 'HIGH', day: 3 },
    { subject: 'Invoice needs my company GSTIN', status: 'WAITING_FOR_CUSTOMER', priority: 'MEDIUM', day: 5 },
    { subject: 'Document upload fails on mobile', status: 'CLOSED', priority: 'MEDIUM', day: 20 },
    { subject: 'Want to upgrade from Basic to Standard package', status: 'OPEN', priority: 'MEDIUM', day: 1 },
  ] as const;
  const year = now.getFullYear();
  for (const [i, t] of tickets.entries()) {
    const customer = customers[(i * 2 + 1) % customers.length];
    const app = apps.find((a) => a.customerId === customer.user.id);
    const createdAt = daysAgo(t.day, 10 + i);
    const answered = t.status !== 'OPEN';
    await prisma.ticket.create({ // NOSONAR: seed writes run in order
      data: {
        code: `TKT-${year}-${String(i + 1).padStart(6, '0')}`, customerId: customer.user.id, applicationId: i % 2 ? app?.id : undefined,
        subject: t.subject, description: `${t.subject}. Please help me with this as soon as possible.`, priority: t.priority, status: t.status,
        assignedToId: answered ? staff.support.id : null, firstResponseAt: answered ? later(createdAt, 2) : null,
        resolvedAt: t.status === 'RESOLVED' || t.status === 'CLOSED' ? later(createdAt, 26) : null, createdAt,
        conversations: {
          create: {
            createdAt,
            messages: {
              create: [
                { senderId: customer.user.id, body: `${t.subject}. Please help me with this as soon as possible.`, createdAt, readAt: answered ? later(createdAt, 1) : null },
                ...(answered ? [{ senderId: staff.support.id, body: 'Thanks for reaching out. We are looking into this and will update you shortly.', createdAt: later(createdAt, 2), readAt: later(createdAt, 3) }] : []),
                ...(t.status === 'WAITING_FOR_CUSTOMER' ? [{ senderId: staff.support.id, body: 'Please share your company GSTIN so we can reissue the invoice.', createdAt: later(createdAt, 4) }] : []),
              ],
            },
          },
        },
      },
    });
  }
  console.log(`✓ ${tickets.length} support tickets with replies`);
}

async function seedMarketing() {
  const services = await prisma.service.findMany({ where: { isPopular: true }, select: { id: true }, take: 6 });
  const leads = [
    ['Gurpreet Kaur', '9812300001', 'Ludhiana', 'service_page', 'Need GST registration for my boutique.'],
    ['Arvind Rao', '9812300002', 'Chennai', 'contact', 'Can you help with company closure?'],
    ['Farah Khan', '9812300003', 'Mumbai', 'home', null],
    ['Nitin Saini', '9812300004', 'Panipat', 'service_page', 'What documents are needed for trademark?'],
    ['Lakshmi Menon', '9812300005', 'Thrissur', 'service_page', 'Looking for FSSAI licence for a cloud kitchen.'],
    ['Rohit Sharma', '9812300006', 'Delhi', 'contact', 'Please call me about ISO certification costs.'],
    ['Meera Pillai', '9812300007', 'Kochi', 'home', null],
    ['Sahil Arora', '9812300008', 'Jalandhar', 'service_page', 'Want to register an LLP with my brother.'],
  ] as const;
  await prisma.lead.createMany({
    data: leads.map(([name, mobile, city, source, message], i) => ({
      name, mobile, city, source, message, email: `${name.split(' ')[0].toLowerCase()}@example.com`, serviceId: source === 'service_page' ? services[i % services.length]?.id : null, createdAt: daysAgo(i * 2, 12),
    })),
  });

  const queries = [['gst registration', 6], ['trademark', 4], ['company registration', 5], ['fssai', 2], ['import export code', 1], ['udyam', 1], ['partnership deed', 0], ['crypto licence', 0]] as const;
  await prisma.searchQuery.createMany({ data: queries.flatMap(([query, resultCount], i) => Array.from({ length: 6 - (i % 5) }, (_, k) => ({ query, resultCount, createdAt: daysAgo(k * 3 + i, 15) }))) });

  for (const p of BLOG_POSTS) {
    const cat = await prisma.blogCategory.findUnique({ where: { slug: p.cat } }); // NOSONAR: seed writes run in order
    const tags = p.tags.map((name) => {
      const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
      return { where: { slug }, create: { slug, name } };
    });
    await prisma.blogPost.upsert({ // NOSONAR: seed writes run in order
      where: { slug: p.slug }, update: {},
      create: {
        slug: p.slug, title: p.title, excerpt: p.excerpt, content: p.content, categoryId: cat?.id, authorName: 'BizNexa Team', status: p.status,
        seoTitle: p.title.slice(0, 70), metaDescription: p.excerpt, publishedAt: p.status === 'PUBLISHED' ? daysAgo(p.day) : null, createdAt: daysAgo(p.day + 1),
        tags: { connectOrCreate: tags },
        ...(cat ? { categories: { create: { categoryId: cat.id } } } : {}),
      },
    });
  }
  console.log(`✓ ${leads.length} leads, ${queries.length} search terms, ${BLOG_POSTS.length} blog posts with tags`);
}

/** Website content instead of the base seed's placeholders: CMS pages, homepage blocks and testimonials. */
async function seedWebsite() {
  // Only pages still holding the base seed's placeholder (legacy `blocks`) or missing; an edited page is kept.
  for (const p of CMS_PAGES) {
    const existing = await prisma.cmsPage.findUnique({ where: { slug: p.slug }, select: { content: true } }); // NOSONAR: seed writes run in order
    if (existing && !(existing.content && typeof existing.content === 'object' && 'blocks' in existing.content)) continue;
    const data = { title: p.title, content: { html: p.html }, seoTitle: p.seoTitle, metaDescription: p.metaDescription, contactEmail: p.contactEmail ?? null, contactPhone: p.contactPhone ?? null, status: 'PUBLISHED' as const };
    await prisma.cmsPage.upsert({ where: { slug: p.slug }, update: data, create: { slug: p.slug, ...data } }); // NOSONAR: seed writes run in order
  }

  await prisma.testimonial.deleteMany({ where: { quote: { startsWith: 'Placeholder testimonial' } } });
  if (!(await prisma.testimonial.count())) await prisma.testimonial.createMany({ data: TESTIMONIALS.map((t, sortOrder) => ({ ...t, sortOrder })) });

  if (!(await prisma.banner.count({ where: { placement: 'home' } }))) {
    await prisma.banner.createMany({
      data: [
        { title: 'Festive offer: 25% off on company registration', subtitle: 'Use code DIWALI25 at checkout', linkUrl: '/services/company-registration', placement: 'home', sortOrder: 0 },
        { title: 'Talk to a CA in 10 minutes', subtitle: 'Book a video consultation from ₹299', linkUrl: '/consultants', placement: 'home', sortOrder: 1 },
      ],
    });
  }

  // Homepage: keep the counters, add popular services and FAQs unless an admin already chose them.
  const row = await prisma.setting.findUnique({ where: { key: 'home.cms' } });
  const home = (row?.value ?? {}) as { stats?: unknown[]; popularServiceIds?: string[]; faq?: unknown[] };
  const services = await prisma.service.findMany({ where: { slug: { in: HOME_POPULAR }, isActive: true }, select: { id: true, slug: true } });
  const value = {
    stats: home.stats ?? [],
    popularServiceIds: home.popularServiceIds?.length ? home.popularServiceIds : HOME_POPULAR.map((s) => services.find((x) => x.slug === s)?.id).filter((id): id is string => !!id),
    faq: home.faq?.length ? home.faq : HOME_FAQ.map((f, sortOrder) => ({ ...f, sortOrder, isActive: true })),
  };
  await prisma.setting.upsert({ where: { key: 'home.cms' }, update: { value: json(value) }, create: { key: 'home.cms', value: json(value) } });
  console.log(`✓ website content: ${CMS_PAGES.length} CMS pages, ${TESTIMONIALS.length} testimonials, 2 banners, homepage popular services and FAQs`);
}

async function seedStaffNotifications(staff: Staff) {
  await prisma.notification.createMany({
    data: [
      { userId: staff.ops.id, channel: 'IN_APP', event: 'document.uploaded', title: 'New documents to review', body: '2 applications have documents waiting for review.', link: '/applications', status: 'SENT', createdAt: daysAgo(0, 9) },
      { userId: staff.support.id, channel: 'IN_APP', event: 'ticket.created', title: 'New urgent ticket', body: 'Payment deducted but order shows pending', link: '/tickets', status: 'SENT', createdAt: daysAgo(0, 10) },
      { userId: staff.admin.id, channel: 'IN_APP', event: 'consultant.applied', title: 'Consultant awaiting approval', body: 'Manish Arora applied as a Business Consultant.', link: '/consultants', status: 'SENT', createdAt: daysAgo(1, 16) },
    ],
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.log('• Demo data is not added in production.');
    return;
  }
  if (await prisma.user.findFirst({ where: { email: { endsWith: '@demo.biznexa.local' } } })) {
    console.log('• Demo data is already there. Reset the database (pnpm db:reset && pnpm db:seed) to add it again.');
    return;
  }
  const byEmail = (email: string) => prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
  const [admin, ops, support, consultant] = await Promise.all(['admin', 'ops', 'support', 'consultant'].map((u) => byEmail(`${u}@biznexa.local`)));
  if (!admin || !ops || !support || !consultant || !(await prisma.service.count())) {
    throw new Error('Run the base seed first (NODE_ENV=development pnpm db:seed): demo staff users and services are missing.');
  }
  const staff: Staff = { admin, ops, support, consultant };

  const customers = await seedCustomers();
  const coupons = await seedCoupons();
  await seedApplications(customers, coupons, staff);
  await seedBookings(customers, staff);
  await seedTickets(customers, staff);
  await seedMarketing();
  await seedWebsite();
  await seedStaffNotifications(staff);
  console.log(`✓ demo files written to ${UPLOAD_DIR}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
