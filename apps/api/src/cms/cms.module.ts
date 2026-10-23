import { BadRequestException, Controller, Get, Module, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, PERMS, Public, RequirePermissions } from '../common/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { AuditModule } from '../audit/audit.module';
import { richTextInput } from './rich-text';
import { z } from 'zod';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { isMediaPath, safeLinkHref } from '@biznexa/types';
import { EventBus } from '../events/event-bus';
import { env } from '../config/env';
import { Prisma } from '../generated/prisma/client';

const mediaUrl = z.string().trim().max(500).nullable().refine((url) => url === null || isMediaPath(url), 'Choose an image uploaded to the public media library');
const safeUrl = z.string().trim().max(500).nullable().refine((url) => url === null || safeLinkHref(url) !== null, 'Enter a safe web link');
const pageInput = z.object({ slug: z.enum(['about', 'terms', 'privacy', 'refund-policy', 'contact']), title: z.string().trim().min(1).max(160), content: z.object({ html: richTextInput }), seoTitle: z.string().trim().max(160).nullable(), metaDescription: z.string().trim().max(320).nullable(), ogImageUrl: mediaUrl, contactEmail: z.string().trim().email().max(254).nullable(), contactPhone: z.string().trim().max(40).nullable() });
type PageInput = z.infer<typeof pageInput>;
const homeInput = z.object({ banners: z.array(z.object({ id: z.string().optional(), title: z.string().trim().min(1).max(160), subtitle: z.string().max(500).nullable(), imageUrl: mediaUrl, linkUrl: safeUrl, sortOrder: z.number().int().min(0), isActive: z.boolean() })).max(20), testimonials: z.array(z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(120), company: z.string().max(160).nullable(), quote: z.string().trim().min(1).max(2000), rating: z.number().int().min(1).max(5), sortOrder: z.number().int().min(0), isActive: z.boolean() })).max(50), stats: z.array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(80), sortOrder: z.number().int().min(0), isActive: z.boolean() })).max(12), popularServiceIds: z.array(z.string().uuid()).max(8), faq: z.array(z.object({ question: z.string().trim().min(1).max(240), answer: richTextInput, sortOrder: z.number().int().min(0), isActive: z.boolean() })).max(30) });
type HomeInput = z.infer<typeof homeInput>;
const legacyBlockSchema = z.object({ type: z.enum(['paragraph', 'heading', 'list']), text: z.string().optional(), items: z.array(z.string()).optional() });
const pageSchema = z.object({
  id: z.string(), slug: z.enum(['about', 'terms', 'privacy', 'refund-policy', 'contact']), title: z.string(),
  content: z.union([z.object({ html: z.string() }), z.object({ blocks: z.array(legacyBlockSchema) })]),
  seoTitle: z.string().nullable(), metaDescription: z.string().nullable(), ogImageUrl: z.string().nullable(),
  contactEmail: z.string().nullable(), contactPhone: z.string().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED']), updatedAt: z.string().datetime(),
  draftTitle: z.string().nullable().optional(), draftContent: z.union([z.object({ html: z.string() }), z.object({ blocks: z.array(legacyBlockSchema) })]).nullable().optional(),
  draftSeoTitle: z.string().nullable().optional(), draftMetaDescription: z.string().nullable().optional(), draftOgImageUrl: z.string().nullable().optional(), draftContactEmail: z.string().nullable().optional(), draftContactPhone: z.string().nullable().optional(),
});
const bannerSchema = z.object({ id: z.string(), title: z.string(), subtitle: z.string().nullable(), imageUrl: z.string().nullable(), linkUrl: z.string().nullable(), placement: z.string(), sortOrder: z.number(), isActive: z.boolean() });
const testimonialSchema = z.object({ id: z.string(), name: z.string(), company: z.string().nullable(), quote: z.string(), rating: z.number(), sortOrder: z.number(), isActive: z.boolean() });
const homepageSchema = z.object({ banners: z.array(bannerSchema), testimonials: z.array(testimonialSchema), stats: z.array(z.object({ label: z.string(), value: z.string(), sortOrder: z.number(), isActive: z.boolean() })), popularServiceIds: z.array(z.string()), faq: z.array(z.object({ question: z.string(), answer: z.string(), sortOrder: z.number(), isActive: z.boolean() })) });
const serviceOptionsSchema = z.array(z.object({ id: z.string(), name: z.string() }));

/** Public read access to published CMS pages (About, Terms, Privacy, Refund Policy). Editing arrives with the admin CMS milestone. */
@ApiTags('cms')
@Public()
@Controller('cms')
export class CmsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('pages/:slug')
  async page(@Param('slug') slug: string) {
    const page = await this.prisma.cmsPage.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { slug: true, title: true, content: true, seoTitle: true, metaDescription: true, ogImageUrl: true, contactEmail: true, contactPhone: true, updatedAt: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  @Get('settings/public')
  async settings() {
    const keys = ['company.name', 'company.email', 'company.phone', 'home.stats', 'home.cms'];
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @Get('homepage')
  async homepage() {
    const [banners, testimonials, setting] = await Promise.all([
      this.prisma.banner.findMany({ where: { placement: 'home', isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.testimonial.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.setting.findUnique({ where: { key: 'home.cms' } }),
    ]);
    const config = (setting?.value ?? {}) as { stats?: unknown; popularServiceIds?: unknown; faq?: unknown };
    const ids = Array.isArray(config.popularServiceIds) ? config.popularServiceIds.filter((id): id is string => typeof id === 'string') : [];
    const services = ids.length ? await this.prisma.service.findMany({ where: { id: { in: ids }, isActive: true, deletedAt: null }, include: { category: true, subcategory: true, packages: { where: { isActive: true }, orderBy: { professionalFee: 'asc' }, take: 1 } } }) : [];
    const popularServices = ids.map((id) => services.find((service) => service.id === id)).filter((s) => s != null);
    const active = (items: unknown) => Array.isArray(items)
      ? (items as { isActive?: unknown; sortOrder?: unknown }[])
          .filter((item) => typeof item === 'object' && item !== null && item.isActive === true)
          .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
      : [];
    return { banners, testimonials, stats: active(config.stats), faq: active(config.faq), popularServices };
  }
}

@ApiTags('admin · cms')
@Controller('admin/cms')
class AdminCmsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly events: EventBus) {}

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('CmsHomepage', homepageSchema)
  @Get('homepage')
  async homepage() {
    const [banners, testimonials, setting] = await Promise.all([
      this.prisma.banner.findMany({ where: { placement: 'home' }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.testimonial.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.setting.findUnique({ where: { key: 'home.cms' } }),
    ]);
    const v = (setting?.value ?? {}) as Record<string, unknown>;
    return { banners, testimonials, stats: Array.isArray(v.stats) ? v.stats : [], popularServiceIds: Array.isArray(v.popularServiceIds) ? v.popularServiceIds : [], faq: Array.isArray(v.faq) ? v.faq : [] };
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('CmsServices', serviceOptionsSchema)
  @Get('homepage/services')
  services() { return this.prisma.service.findMany({ where: { isActive: true, deletedAt: null }, orderBy: [{ popularity: 'desc' }, { name: 'asc' }], select: { id: true, name: true } }); }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('CmsHomepage', homepageSchema)
  @Put('homepage')
  async saveHomepage(@ZodBody(homeInput) body: HomeInput, @CurrentUser() user: AuthUser) {
    if (new Set(body.popularServiceIds).size !== body.popularServiceIds.length) throw new BadRequestException('Choose each popular service only once');
    const services = await this.prisma.service.findMany({ where: { id: { in: body.popularServiceIds }, isActive: true, deletedAt: null }, select: { id: true } });
    if (services.length !== body.popularServiceIds.length) throw new NotFoundException('Choose active services from the catalogue');
    const before = await this.homepage();
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.banner.deleteMany({ where: { placement: 'home' } });
      if (body.banners.length) await tx.banner.createMany({ data: body.banners.map(({ id: _id, ...b }) => ({ ...b, placement: 'home' })) });
      await tx.testimonial.deleteMany({});
      if (body.testimonials.length) await tx.testimonial.createMany({ data: body.testimonials.map(({ id: _id, ...t }) => t) });
      const value = { stats: body.stats, popularServiceIds: body.popularServiceIds, faq: body.faq };
      await tx.setting.upsert({ where: { key: 'home.cms' }, create: { key: 'home.cms', value }, update: { value } });
      return { ...value, banners: body.banners, testimonials: body.testimonials };
    });
    await this.audit.log({ actorId: user.id, action: 'cms.homepage.update', entityType: 'CmsHomepage', entityId: 'home', before, after });
    await this.events.emit('catalogue.changed', { entityType: 'homepage' });
    // The web route always refreshes `/`; 'home' names no CMS page.
    await this.revalidateWeb('home');
    return after;
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('CmsPageList', z.array(pageSchema))
  @Get('pages')
  adminPages() { return this.prisma.cmsPage.findMany({ orderBy: { slug: 'asc' } }); }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('CmsPage', pageSchema)
  @Put('pages')
  async savePage(@ZodBody(pageInput) body: PageInput, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.cmsPage.findUnique({ where: { slug: body.slug } });
    const page = before?.status === 'PUBLISHED'
      ? await this.prisma.cmsPage.update({ where: { slug: body.slug }, data: { draftTitle: body.title, draftContent: body.content, draftSeoTitle: body.seoTitle, draftMetaDescription: body.metaDescription, draftOgImageUrl: body.ogImageUrl, draftContactEmail: body.contactEmail, draftContactPhone: body.contactPhone } })
      : await this.prisma.cmsPage.upsert({ where: { slug: body.slug }, create: { ...body, status: 'DRAFT' }, update: { title: body.title, content: body.content, seoTitle: body.seoTitle, metaDescription: body.metaDescription, ogImageUrl: body.ogImageUrl, contactEmail: body.contactEmail, contactPhone: body.contactPhone } });
    await this.audit.log({ actorId: user.id, action: 'cms.page.save', entityType: 'CmsPage', entityId: page.id, before, after: page });
    return page;
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('CmsPage', pageSchema, 201)
  @Post('pages/:slug/publish')
  async publishPage(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.cmsPage.findUnique({ where: { slug } });
    if (!before) throw new NotFoundException('Page not found');
    const hasDraft = before.draftTitle !== null;
    const page = await this.prisma.cmsPage.update({ where: { slug }, data: { ...(hasDraft ? { title: before.draftTitle!, content: before.draftContent!, seoTitle: before.draftSeoTitle, metaDescription: before.draftMetaDescription, ogImageUrl: before.draftOgImageUrl, contactEmail: before.draftContactEmail, contactPhone: before.draftContactPhone, draftTitle: null, draftContent: Prisma.DbNull, draftSeoTitle: null, draftMetaDescription: null, draftOgImageUrl: null, draftContactEmail: null, draftContactPhone: null } : {}), status: 'PUBLISHED' } });
    await this.audit.log({ actorId: user.id, action: 'cms.page.publish', entityType: 'CmsPage', entityId: page.id, before, after: page });
    await this.revalidateWeb(slug);
    return page;
  }

  private async revalidateWeb(slug: string) {
    const secret = env().REVALIDATE_SECRET;
    const webUrl = env().PUBLIC_WEB_URL;
    if (!secret || !webUrl) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(`${webUrl}/api/revalidate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret }, body: JSON.stringify({ slugs: [slug] }), signal: controller.signal });
    } catch { /* Publishing remains saved if the web cache is unavailable; the cache TTL is bounded. */ }
    finally { clearTimeout(timer); }
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('CmsPage', pageSchema)
  @Post('pages/:slug/discard-draft')
  async discardDraft(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.cmsPage.findUnique({ where: { slug } });
    if (!before) throw new NotFoundException('Page not found');
    const page = await this.prisma.cmsPage.update({ where: { slug }, data: { draftTitle: null, draftContent: Prisma.DbNull, draftSeoTitle: null, draftMetaDescription: null, draftOgImageUrl: null, draftContactEmail: null, draftContactPhone: null } });
    await this.audit.log({ actorId: user.id, action: 'cms.page.discard_draft', entityType: 'CmsPage', entityId: page.id, before, after: page });
    return page;
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('CmsPage', pageSchema, 201)
  @Post('pages/:slug/unpublish')
  async unpublishPage(@Param('slug') slug: string, @CurrentUser() user: AuthUser) {
    const before = await this.prisma.cmsPage.findUnique({ where: { slug } });
    if (!before) throw new NotFoundException('Page not found');
    const page = await this.prisma.cmsPage.update({ where: { slug }, data: { status: 'DRAFT' } });
    await this.audit.log({ actorId: user.id, action: 'cms.page.unpublish', entityType: 'CmsPage', entityId: page.id, before: { status: before.status }, after: { status: page.status } });
    await this.revalidateWeb(slug);
    return page;
  }
}

@Module({ imports: [AuditModule], controllers: [CmsController, AdminCmsController] })
export class CmsModule {}
