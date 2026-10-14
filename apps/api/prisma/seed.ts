/**
 * Idempotent seed: roles & permissions, demo staff/customer users (non-production only),
 * the full service catalogue and its application forms, certification bodies, demo certificates and base settings.
 *
 *   pnpm db:seed
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { stateName } from '@biznexa/types';
import { PrismaClient } from '../src/generated/prisma/client';
import { CATEGORIES, CERTIFICATION_BODIES, TESTIMONIALS } from './seed-data';
import { seedAccess } from './seed-access';
import { seedForms } from './seed-forms';
import { seedNotificationTemplates } from './seed-notifications';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const isProd = process.env.NODE_ENV === 'production';
const paise = (rupees: number) => Math.round(rupees * 100);
/** Price ladder for Standard/Premium: rounds up to the next ₹500 and ends in 99 (e.g. ₹11,499). */
const ladder = (base: number, factor: number) => Math.ceil((base * factor) / 500) * 500 - 1;

export const DEMO_USERS = [
  { name: 'Admin User', email: 'admin@biznexa.local', mobile: '9000000001', password: 'Admin@12345', role: 'ADMIN' },
  { name: 'Ops Executive', email: 'ops@biznexa.local', mobile: '9000000002', password: 'Ops@12345', role: 'OPERATIONS' },
  { name: 'Support Executive', email: 'support@biznexa.local', mobile: '9000000003', password: 'Support@12345', role: 'SUPPORT' },
  { name: 'Demo Consultant', email: 'consultant@biznexa.local', mobile: '9000000004', password: 'Consultant@12345', role: 'CONSULTANT' },
  { name: 'Demo Customer', email: 'customer@biznexa.local', mobile: '9876543210', password: 'Customer@12345', role: 'CUSTOMER' },
];

async function seedUsers() {
  if (isProd) {
    console.log('• Skipping demo users in production. Create the first admin with: ADMIN_NAME=... ADMIN_EMAIL=... ADMIN_MOBILE=... ADMIN_PASSWORD=... pnpm --filter @biznexa/api create-admin');
    return;
  }
  for (const u of DEMO_USERS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: u.role } });
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        mobile: u.mobile,
        passwordHash: await bcrypt.hash(u.password, 12),
        emailVerified: true,
        mobileVerified: true,
        consentAt: new Date(),
        customerProfile: u.role === 'CUSTOMER' ? { create: { state: 'PB', city: 'Ludhiana' } } : undefined,
      },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
  }
  console.log(`✓ ${DEMO_USERS.length} demo users`);
}

async function seedCatalogue() {
  let created = 0;
  for (const [ci, c] of CATEGORIES.entries()) {
    const category = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: {
        slug: c.slug,
        name: c.name,
        tagline: c.tagline,
        description: c.description,
        icon: c.icon,
        journeyStage: c.journeyStage,
        sortOrder: ci,
        seoTitle: `${c.name} Services Online | BizNexa`,
        metaDescription: c.description.slice(0, 160),
      },
    });

    const subIds: Record<string, string> = {};
    for (const [si, s] of (c.subcategories ?? []).entries()) {
      const sub = await prisma.subcategory.upsert({
        where: { categoryId_slug: { categoryId: category.id, slug: s.slug } },
        update: {},
        create: { categoryId: category.id, slug: s.slug, name: s.name, sortOrder: si },
      });
      subIds[s.slug] = sub.id;
    }

    for (const s of c.services) {
      if (await prisma.service.findUnique({ where: { slug: s.slug } })) continue;
      const govt = paise(s.govtFee ?? 0);
      await prisma.service.create({
        data: {
          slug: s.slug,
          name: s.name,
          categoryId: category.id,
          subcategoryId: s.subcategory ? subIds[s.subcategory] : undefined,
          shortDescription: s.short,
          overview: `${s.short}\n\n${c.description}\n\nWith BizNexa you fill one simple form, upload documents online and track every step from your dashboard. A dedicated expert prepares and files your application, and you receive the final documents in your account.`,
          icon: s.icon ?? c.icon,
          benefits: c.benefits,
          estimatedTime: s.time,
          estimatedDaysMin: s.days[0],
          estimatedDaysMax: s.days[1],
          sacCode: c.sac,
          popularity: s.popular ?? 0,
          isPopular: !!s.featured,
          recurrence: s.recurrence,
          seoTitle: `${s.name} Online | BizNexa`.slice(0, 70),
          metaDescription: s.short.slice(0, 160),
          packages: {
            create: [
              { name: 'Basic', professionalFee: paise(s.price), governmentFee: govt, inclusions: c.inclusions.basic, sortOrder: 0 },
              { name: 'Standard', professionalFee: paise(ladder(s.price, 1.6)), governmentFee: govt, inclusions: c.inclusions.standard, isMostPopular: true, sortOrder: 1, allowPartial: c.slug === 'business-technology', advancePercent: c.slug === 'business-technology' ? 50 : null },
              { name: 'Premium', professionalFee: paise(ladder(s.price, 2.6)), governmentFee: govt, inclusions: c.inclusions.premium, sortOrder: 2, allowPartial: c.slug === 'business-technology', advancePercent: c.slug === 'business-technology' ? 50 : null },
            ],
          },
          documents: {
            create: (s.documents ?? c.documents).map((name, i) => ({
              name,
              isMandatory: !/if applicable|if any|optional|if available|if existing|if different/i.test(name),
              sortOrder: i,
            })),
          },
          stages: { create: c.stages.map((name, i) => ({ name, sortOrder: i + 1 })) },
          faqs: { create: c.faqs.map((f, i) => ({ question: f.q, answer: f.a, sortOrder: i })) },
        },
      });
      created++;
    }

    // Related services: the next most popular services in the same category.
    const services = await prisma.service.findMany({ where: { categoryId: category.id }, orderBy: { popularity: 'desc' } });
    for (const s of services) {
      const existing = await prisma.serviceRelation.count({ where: { fromId: s.id } });
      if (existing) continue;
      const related = services.filter((x) => x.id !== s.id).slice(0, 3);
      if (related.length) await prisma.serviceRelation.createMany({ data: related.map((r) => ({ fromId: s.id, toId: r.id })) });
    }
  }
  const total = await prisma.service.count();
  console.log(`✓ ${CATEGORIES.length} categories, ${total} services (${created} new)`);
}

async function seedCertificates() {
  for (const b of CERTIFICATION_BODIES) {
    await prisma.certificationBody.upsert({ where: { name: b.name }, update: {}, create: b });
  }
  if (isProd) return;
  const body = await prisma.certificationBody.findFirstOrThrow();
  const year = new Date().getFullYear();
  const demo = [
    { certificateNumber: 'BNC-DEMO-000001', verificationId: 'DEMQ9001ACTV', type: 'ISO 9001:2015 — Quality Management System', status: 'ACTIVE' as const, from: new Date(`${year - 1}-04-01`), until: new Date(`${year + 2}-03-31`) },
    { certificateNumber: 'BNC-DEMO-000002', verificationId: 'DEMQ14KEXPRD', type: 'ISO 14001:2015 — Environmental Management System', status: 'EXPIRED' as const, from: new Date(`${year - 4}-01-15`), until: new Date(`${year - 1}-01-14`) },
    { certificateNumber: 'BNC-DEMO-000003', verificationId: 'DEMQ45KSUSPN', type: 'ISO 45001:2018 — Occupational Health & Safety', status: 'SUSPENDED' as const, from: new Date(`${year - 1}-07-01`), until: new Date(`${year + 2}-06-30`) },
  ];
  for (const d of demo) {
    await prisma.certificate.upsert({
      where: { certificateNumber: d.certificateNumber },
      update: {},
      create: {
        certificateNumber: d.certificateNumber,
        verificationId: d.verificationId,
        type: d.type,
        organizationName: 'Demo Industries Private Limited',
        scope: 'Manufacturing and supply of demo products (sample data)',
        issueDate: d.from,
        validFrom: d.from,
        validUntil: d.until,
        status: d.status,
        statusReason: d.status === 'SUSPENDED' ? 'Surveillance audit pending' : d.status === 'EXPIRED' ? 'Validity period ended' : null,
        certificationBodyId: body.id,
      },
    });
  }
  console.log(`✓ ${CERTIFICATION_BODIES.length} certification bodies, ${demo.length} demo certificates`);
}

async function seedContent() {
  const settings: Record<string, unknown> = {
    'company.name': 'BizNexa',
    'company.legalName': 'BizNexa (legal entity name to be added)',
    'company.gstin': '',
    // Stored as the state's name (M3.14); `COMPANY_STATE_CODE` may be a name, `PB` or `03`.
    'company.state': stateName(process.env.COMPANY_STATE_CODE) ?? 'Punjab',
    'company.email': 'support@biznexa.com',
    'company.phone': '',
    'invoice.prefix': 'BN',
    'certificates.organizationSearch': true,
    'home.stats': [
      { label: 'Services', value: '60+' },
      { label: 'Categories', value: '7' },
      { label: 'Process', value: '100% online' },
      { label: 'Support', value: 'Dedicated expert' },
    ],
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: value as object } });
  }

  if (!(await prisma.testimonial.count())) {
    await prisma.testimonial.createMany({ data: TESTIMONIALS.map((t, i) => ({ ...t, sortOrder: i })) });
  }

  const pages = [
    { slug: 'about', title: 'About BizNexa' },
    { slug: 'terms', title: 'Terms & Conditions' },
    { slug: 'privacy', title: 'Privacy Policy' },
    { slug: 'refund-policy', title: 'Refund Policy' },
  ];
  for (const p of pages) {
    await prisma.cmsPage.upsert({
      where: { slug: p.slug },
      update: {},
      create: { ...p, status: 'PUBLISHED', content: { blocks: [{ type: 'paragraph', text: 'Content to be provided by the BizNexa team and reviewed by legal before launch.' }] } },
    });
  }

  const blogCats = ['Business Articles', 'Tax Updates', 'Trademark', 'GST', 'Compliance Updates', 'Certification'];
  for (const name of blogCats) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await prisma.blogCategory.upsert({ where: { slug }, update: {}, create: { slug, name } });
  }
  console.log('✓ settings, CMS pages, testimonials, blog categories');
}

async function main() {
  await seedAccess(prisma);
  await seedUsers();
  await seedCatalogue();
  const forms = await seedForms(prisma);
  console.log(`✓ application forms: ${forms.created} new, ${forms.upgraded} moved to their ready-made form, ${forms.kept} kept`);
  await seedCertificates();
  await seedContent();
  await seedNotificationTemplates(prisma);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
