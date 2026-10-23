/**
 * Idempotent seed: roles & permissions, demo staff/customer users and approved consultants (non-production only),
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
  { name: 'Admin User', email: 'admin@biznexa.local', mobile: '9000000001', password: 'Admin@12345', role: 'ADMIN' }, // NOSONAR: seed credential
  { name: 'Ops Executive', email: 'ops@biznexa.local', mobile: '9000000002', password: 'Ops@12345', role: 'OPERATIONS' }, // NOSONAR: seed credential
  { name: 'Support Executive', email: 'support@biznexa.local', mobile: '9000000003', password: 'Support@12345', role: 'SUPPORT' }, // NOSONAR: seed credential
  { name: 'Demo Consultant', email: 'consultant@biznexa.local', mobile: '9000000004', password: 'Consultant@12345', role: 'CONSULTANT' }, // NOSONAR: seed credential
  { name: 'Demo Customer', email: 'customer@biznexa.local', mobile: '9876543210', password: 'Customer@12345', role: 'CUSTOMER' }, // NOSONAR: seed credential
];

async function seedUsers() {
  if (isProd) {
    console.log('• Skipping demo users in production. Create the first admin with: ADMIN_NAME=... ADMIN_EMAIL=... ADMIN_MOBILE=... ADMIN_PASSWORD=... pnpm --filter @biznexa/api create-admin');
    return;
  }
  for (const u of DEMO_USERS) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: u.role } }); // NOSONAR: seed writes run in order
    const user = await prisma.user.upsert({ // NOSONAR: seed writes run in order
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        mobile: u.mobile,
        passwordHash: await bcrypt.hash(u.password, 12), // NOSONAR: seed writes run in order
        emailVerified: true,
        mobileVerified: true,
        consentAt: new Date(),
        customerProfile: u.role === 'CUSTOMER' ? { create: { state: 'PB', city: 'Ludhiana' } } : undefined,
      },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } }); // NOSONAR: seed writes run in order
  }
  console.log(`✓ ${DEMO_USERS.length} demo users`);
}

type DemoConsultant = {
  name: string; email: string; mobile: string; category: 'CA' | 'CS' | 'LAWYER' | 'TAX_CONSULTANT' | 'TRADEMARK_CONSULTANT' | 'ISO_CONSULTANT' | 'BUSINESS_CONSULTANT' | 'TECHNOLOGY_CONSULTANT';
  qualification: string; experienceYears: number; expertise: string[]; languages: string[]; city: string; state: string;
  fee: number; types: ('AUDIO' | 'VIDEO' | 'CHAT' | 'MEETING')[]; rating: number; featured?: boolean;
};

const DEMO_CONSULTANTS: DemoConsultant[] = [
  { name: 'Demo Consultant', email: 'consultant@biznexa.local', mobile: '9000000004', category: 'CA', qualification: 'Chartered Accountant (ICAI)', experienceYears: 8, expertise: ['GST', 'Income Tax', 'Company Registration'], languages: ['English', 'Hindi', 'Punjabi'], city: 'Ludhiana', state: 'Punjab', fee: 499, types: ['AUDIO', 'VIDEO', 'CHAT'], rating: 4.8, featured: true },
  { name: 'Priya Sharma', email: 'priya.cs@biznexa.local', mobile: '9000000011', category: 'CS', qualification: 'Company Secretary (ICSI)', experienceYears: 6, expertise: ['ROC Compliance', 'LLP', 'Annual Filings'], languages: ['English', 'Hindi'], city: 'Chandigarh', state: 'Chandigarh', fee: 599, types: ['VIDEO', 'CHAT'], rating: 4.6, featured: true },
  { name: 'Arjun Mehta', email: 'arjun.lawyer@biznexa.local', mobile: '9000000012', category: 'LAWYER', qualification: 'LLB, Advocate', experienceYears: 12, expertise: ['Contracts', 'Legal Notices', 'Startup Law'], languages: ['English', 'Hindi'], city: 'New Delhi', state: 'Delhi', fee: 999, types: ['AUDIO', 'VIDEO', 'MEETING'], rating: 4.7 },
  { name: 'Neha Gupta', email: 'neha.tm@biznexa.local', mobile: '9000000013', category: 'TRADEMARK_CONSULTANT', qualification: 'Registered Trademark Agent', experienceYears: 5, expertise: ['Trademark Registration', 'Objection Reply', 'Copyright'], languages: ['English', 'Hindi'], city: 'Mumbai', state: 'Maharashtra', fee: 399, types: ['AUDIO', 'CHAT'], rating: 4.5 },
  { name: 'Rahul Verma', email: 'rahul.tax@biznexa.local', mobile: '9000000014', category: 'TAX_CONSULTANT', qualification: 'M.Com, Tax Practitioner', experienceYears: 10, expertise: ['ITR Filing', 'TDS', 'GST Returns'], languages: ['English', 'Hindi'], city: 'Jaipur', state: 'Rajasthan', fee: 299, types: ['AUDIO', 'VIDEO'], rating: 4.4 },
  { name: 'Simran Kaur', email: 'simran.iso@biznexa.local', mobile: '9000000015', category: 'ISO_CONSULTANT', qualification: 'ISO 9001 Lead Auditor', experienceYears: 7, expertise: ['ISO 9001', 'ISO 14001', 'ISO 45001'], languages: ['English', 'Hindi', 'Punjabi'], city: 'Amritsar', state: 'Punjab', fee: 799, types: ['VIDEO', 'MEETING'], rating: 4.9, featured: true },
];

/** Approved demo consultants with Mon–Sat availability, so the listing, booking and consultant portal have data. */
async function seedConsultants() {
  if (isProd) return;
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'CONSULTANT' } });
  for (const c of DEMO_CONSULTANTS) {
    const user = await prisma.user.upsert({ // NOSONAR: seed writes run in order
      where: { email: c.email },
      update: {},
      create: {
        name: c.name, email: c.email, mobile: c.mobile,
        passwordHash: await bcrypt.hash('Consultant@12345', 12), // NOSONAR: seed credential
        emailVerified: true, mobileVerified: true, consentAt: new Date(),
      },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } }); // NOSONAR: seed writes run in order
    if (await prisma.consultant.findUnique({ where: { userId: user.id } })) continue; // NOSONAR: seed writes run in order
    await prisma.consultant.create({ // NOSONAR: seed writes run in order
      data: {
        userId: user.id,
        slug: c.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
        category: c.category, qualification: c.qualification, experienceYears: c.experienceYears,
        expertise: c.expertise, languages: c.languages, city: c.city, state: c.state,
        bio: `${c.qualification} with ${c.experienceYears} years of experience in ${c.expertise.join(', ')}. (Demo profile)`,
        feePerSession: paise(c.fee), consultationTypes: c.types, verificationStatus: 'APPROVED',
        rating: c.rating, isOnline: true, isFeatured: !!c.featured,
        availability: {
          create: [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
            { weekday, startTime: '10:00', endTime: '13:00' },
            { weekday, startTime: '15:00', endTime: '18:00' },
          ]),
        },
      },
    });
  }
  console.log(`✓ ${DEMO_CONSULTANTS.length} demo consultants (password Consultant@12345)`);
}

async function seedCatalogue() {
  let created = 0;
  for (const [ci, c] of CATEGORIES.entries()) {
    const category = await prisma.category.upsert({ // NOSONAR: seed writes run in order
      where: { slug: c.slug },
      update: {},
      create: {
        slug: c.slug, name: c.name, tagline: c.tagline, description: c.description,
        icon: c.icon, journeyStage: c.journeyStage, sortOrder: ci,
        seoTitle: `${c.name} Services Online | BizNexa`,
        metaDescription: c.description.slice(0, 160),
      },
    });
    const subIds = await seedSubcategories(c, category.id); // NOSONAR: seed writes run in order
    created += await seedServices(c, category.id, subIds); // NOSONAR: seed writes run in order
    await seedServiceRelations(category.id); // NOSONAR: seed writes run in order
  }
  const total = await prisma.service.count();
  console.log(`✓ ${CATEGORIES.length} categories, ${total} services (${created} new)`);
}

async function seedSubcategories(c: (typeof CATEGORIES)[number], categoryId: string) {
  const subIds: Record<string, string> = {};
  for (const [si, subcategory] of (c.subcategories ?? []).entries()) {
    const sub = await prisma.subcategory.upsert({ // NOSONAR: seed writes run in order
      where: { categoryId_slug: { categoryId, slug: subcategory.slug } },
      update: {},
      create: { categoryId, slug: subcategory.slug, name: subcategory.name, sortOrder: si },
    });
    subIds[subcategory.slug] = sub.id;
  }
  return subIds;
}

async function seedServices(c: (typeof CATEGORIES)[number], categoryId: string, subIds: Record<string, string>) {
  let created = 0;
  for (const service of c.services) {
    if (await prisma.service.findUnique({ where: { slug: service.slug } })) continue; // NOSONAR: seed writes run in order
    const govt = paise(service.govtFee ?? 0);
    await prisma.service.create({ // NOSONAR: seed writes run in order
      data: {
        slug: service.slug, name: service.name, categoryId,
        subcategoryId: service.subcategory ? subIds[service.subcategory] : undefined,
        shortDescription: service.short,
        overview: `${service.short}\n\n${c.description}\n\nWith BizNexa you fill one simple form, upload documents online and track every step from your dashboard. A dedicated expert prepares and files your application, and you receive the final documents in your account.`,
        icon: service.icon ?? c.icon, benefits: c.benefits, estimatedTime: service.time,
        estimatedDaysMin: service.days[0], estimatedDaysMax: service.days[1], sacCode: c.sac,
        popularity: service.popular ?? 0, isPopular: !!service.featured, recurrence: service.recurrence,
        seoTitle: `${service.name} Online | BizNexa`.slice(0, 70), metaDescription: service.short.slice(0, 160),
        packages: {
          create: [
            { name: 'Basic', professionalFee: paise(service.price), governmentFee: govt, inclusions: c.inclusions.basic, sortOrder: 0 },
            { name: 'Standard', professionalFee: paise(ladder(service.price, 1.6)), governmentFee: govt, inclusions: c.inclusions.standard, isMostPopular: true, sortOrder: 1, allowPartial: c.slug === 'business-technology', advancePercent: c.slug === 'business-technology' ? 50 : null },
            { name: 'Premium', professionalFee: paise(ladder(service.price, 2.6)), governmentFee: govt, inclusions: c.inclusions.premium, sortOrder: 2, allowPartial: c.slug === 'business-technology', advancePercent: c.slug === 'business-technology' ? 50 : null },
          ],
        },
        documents: {
          create: (service.documents ?? c.documents).map((name, i) => ({
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
  return created;
}

async function seedServiceRelations(categoryId: string) {
  // Related services: the next most popular services in the same category.
  const services = await prisma.service.findMany({ where: { categoryId }, orderBy: { popularity: 'desc' } });
  for (const service of services) {
    const existing = await prisma.serviceRelation.count({ where: { fromId: service.id } }); // NOSONAR: seed writes run in order
    if (existing) continue;
    const related = services.filter((candidate) => candidate.id !== service.id).slice(0, 3);
    if (related.length) await prisma.serviceRelation.createMany({ data: related.map((r) => ({ fromId: service.id, toId: r.id })) }); // NOSONAR: seed writes run in order
  }
}

function certificateStatusReason(status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED') {
  if (status === 'SUSPENDED') return 'Surveillance audit pending';
  if (status === 'EXPIRED') return 'Validity period ended';
  return null;
}

async function seedCertificates() {
  for (const b of CERTIFICATION_BODIES) {
    await prisma.certificationBody.upsert({ where: { name: b.name }, update: {}, create: b }); // NOSONAR: seed writes run in order
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
    await prisma.certificate.upsert({ // NOSONAR: seed writes run in order
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
        statusReason: certificateStatusReason(d.status),
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
    // Homepage CMS (M9.6): the counters the homepage shows until an admin edits them; no picked services = the popular ones.
    'home.cms': {
      stats: [
        { label: 'Services', value: '80+' },
        { label: 'Categories', value: '7' },
        { label: 'Process', value: '100% online' },
        { label: 'Support', value: 'Dedicated expert' },
      ].map((s, sortOrder) => ({ ...s, sortOrder, isActive: true })),
      popularServiceIds: [],
      faq: [],
    },
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value: value as object } }); // NOSONAR: seed writes run in order
  }
  await prisma.setting.upsert({ where: { key: 'mobile.minSupportedVersion' }, update: {}, create: { key: 'mobile.minSupportedVersion', value: '1.0.0' } });

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
    await prisma.cmsPage.upsert({ // NOSONAR: seed writes run in order
      where: { slug: p.slug },
      update: {},
      create: { ...p, status: 'PUBLISHED', content: { blocks: [{ type: 'paragraph', text: 'Content to be provided by the BizNexa team and reviewed by legal before launch.' }] } },
    });
  }

  const blogCats = ['Business Articles', 'Tax Updates', 'Trademark', 'GST', 'Compliance Updates', 'Certification'];
  for (const name of blogCats) {
    const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
    await prisma.blogCategory.upsert({ where: { slug }, update: {}, create: { slug, name } }); // NOSONAR: seed writes run in order
  }
  console.log('✓ settings, CMS pages, testimonials, blog categories');
}

async function main() {
  await seedAccess(prisma);
  await seedUsers();
  await seedConsultants();
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
