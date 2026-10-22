import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { calculatePrice, type AdminCategoryRow, type AdminServiceDetail, type AdminServiceRow } from '@biznexa/types';
import { z } from 'zod';
import { inSequence } from '../common/in-sequence';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../generated/prisma/client';
import { rank } from './search';
import { EventBus } from '../events/event-bus';
import {
  categoryInput,
  CreateServiceInput,
  documentInput,
  faqInput,
  ListServicesQuery,
  packageInput,
  stageInput,
  subcategoryInput,
  updateServiceInput,
} from './catalogue.schemas';

const cardInclude = {
  category: { select: { slug: true, name: true } },
  subcategory: { select: { slug: true, name: true } },
  packages: { where: { isActive: true }, select: { professionalFee: true, governmentFee: true }, orderBy: { professionalFee: 'asc' } },
} satisfies Prisma.ServiceInclude;

type CardRow = Prisma.ServiceGetPayload<{ include: typeof cardInclude }>;

function toCard(s: CardRow) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    shortDescription: s.shortDescription,
    icon: s.icon,
    estimatedTime: s.estimatedTime,
    startingPrice: s.packages[0]?.professionalFee ?? null,
    governmentFeeFrom: s.packages[0]?.governmentFee ?? 0,
    popularity: s.popularity,
    isPopular: s.isPopular,
    category: s.category,
    subcategory: s.subcategory,
  };
}
export type ServiceCard = ReturnType<typeof toCard>;

const activeService = { isActive: true, deletedAt: null } satisfies Prisma.ServiceWhereInput;

@Injectable()
export class CatalogueService implements OnModuleInit {
  private searchCache?: { at: number; services: (ServiceCard & { type: 'service'; extra: string })[]; posts: { id: string; name: string; slug: string; excerpt: string | null; type: 'post'; popularity: number; extra: string }[] };
  private readonly publicCache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly events: EventBus) {}

  onModuleInit() {
    this.events.on('blog.post_changed', () => this.invalidate());
    this.events.on('catalogue.changed', () => this.invalidate());
  }

  private async cachedPublic<T>(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.publicCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as Promise<T>;
    if (this.publicCache.size >= 256) this.publicCache.clear();
    const pending = load();
    this.publicCache.set(key, { expiresAt: Date.now() + 60_000, value: pending });
    try {
      const value = await pending;
      if (this.publicCache.get(key)?.value === pending) this.publicCache.set(key, { expiresAt: Date.now() + 60_000, value: pending });
      return value;
    } catch (error) {
      if (this.publicCache.get(key)?.value === pending) this.publicCache.delete(key);
      throw error;
    }
  }

  // ─────────────── Public ───────────────

  categories() {
    return this.cachedPublic('categories', () => this.loadCategories());
  }

  private async loadCategories() {
    const cats = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        subcategories: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { slug: true, name: true } },
        services: {
          where: activeService,
          orderBy: [{ popularity: 'desc' }, { name: 'asc' }],
          select: { slug: true, name: true },
        },
      },
    });
    return cats.map(({ services, ...c }) => ({ ...c, serviceCount: services.length, topServices: services.slice(0, 6) }));
  }

  category(slug: string) {
    return this.cachedPublic(`category:${slug}`, () => this.loadCategory(slug));
  }

  private async loadCategory(slug: string) {
    const c = await this.prisma.category.findFirst({
      where: { slug, isActive: true },
      include: { subcategories: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!c) throw new NotFoundException('Category not found');
    return c;
  }

  listServices(q: ListServicesQuery) {
    return this.cachedPublic(`services:${JSON.stringify(q)}`, () => this.loadServices(q));
  }

  private async loadServices(q: ListServicesQuery) {
    const rows = await this.prisma.service.findMany({
      where: {
        ...activeService,
        ...(q.category ? { category: { slug: q.category } } : {}),
        ...(q.subcategory ? { subcategory: { slug: q.subcategory } } : {}),
        ...(q.popular === 'true' ? { isPopular: true } : {}),
      },
      include: cardInclude,
    });
    let cards = rows.map((item) => toCard(item));

    if (q.q) {
      const ids = new Set(rank(cards.map((c) => ({ ...c, extra: `${c.category.name} ${c.shortDescription}` })), q.q, 500).map((c) => c.id));
      cards = cards.filter((c) => ids.has(c.id));
    }
    // Price filters are in rupees for friendlier URLs.
    if (q.minPrice !== undefined) cards = cards.filter((c) => (c.startingPrice ?? 0) >= q.minPrice! * 100);
    if (q.maxPrice !== undefined) cards = cards.filter((c) => (c.startingPrice ?? 0) <= q.maxPrice! * 100);

    const price = (c: ServiceCard) => c.startingPrice ?? Number.MAX_SAFE_INTEGER;
    const sorters: Record<ListServicesQuery['sort'], (a: ServiceCard, b: ServiceCard) => number> = {
      popular: (a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name),
      price_asc: (a, b) => price(a) - price(b),
      price_desc: (a, b) => price(b) - price(a),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    cards.sort(sorters[q.sort]);

    const total = cards.length;
    const start = (q.page - 1) * q.limit;
    return { items: cards.slice(start, start + q.limit), total, page: q.page, limit: q.limit, pages: Math.max(1, Math.ceil(total / q.limit)) };
  }

  popular(limit = 8) {
    return this.cachedPublic(`popular:${limit}`, () => this.loadPopular(limit));
  }

  private async loadPopular(limit: number) {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'home.cms' }, select: { value: true } });
    const value = setting?.value as { popularServiceIds?: unknown } | null;
    if (Array.isArray(value?.popularServiceIds) && value.popularServiceIds.length) {
      const ids = value.popularServiceIds.filter((id): id is string => typeof id === 'string');
      const selected = await this.prisma.service.findMany({ where: { ...activeService, isActive: true, id: { in: ids } }, include: cardInclude });
      const byId = new Map(selected.map((s) => [s.id, s]));
      return ids.map((id) => byId.get(id)).filter((s): s is CardRow => Boolean(s)).slice(0, limit).map((item) => toCard(item));
    }
    const rows = await this.prisma.service.findMany({
      where: { ...activeService, isPopular: true },
      orderBy: { popularity: 'desc' },
      take: limit,
      include: cardInclude,
    });
    return rows.map((item) => toCard(item));
  }

  serviceDetail(slug: string) {
    return this.cachedPublic(`service:${slug}`, () => this.loadServiceDetail(slug));
  }

  private async loadServiceDetail(slug: string) {
    const s = await this.prisma.service.findFirst({
      where: { slug, ...activeService },
      include: {
        category: { select: { slug: true, name: true } },
        subcategory: { select: { slug: true, name: true } },
        packages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        documents: { orderBy: { sortOrder: 'asc' } },
        stages: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, description: true, sortOrder: true } },
        faqs: { orderBy: { sortOrder: 'asc' }, select: { question: true, answer: true } },
        related: { include: { to: { include: cardInclude } } },
      },
    });
    if (!s) throw new NotFoundException('Service not found');

    const { related, packages, ...rest } = s;
    return {
      ...rest,
      startingPrice: packages.length ? Math.min(...packages.map((p) => p.professionalFee)) : null,
      packages: packages.map((p) => ({
        id: p.id,
        name: p.name,
        professionalFee: p.professionalFee,
        governmentFee: p.governmentFee,
        gstRate: p.gstRate,
        inclusions: p.inclusions,
        estimatedTime: p.estimatedTime ?? s.estimatedTime,
        isMostPopular: p.isMostPopular,
        allowPartial: p.allowPartial,
        advancePercent: p.advancePercent,
        // Tax total is the same for CGST+SGST and IGST; the split is decided at checkout from the buyer's state.
        price: calculatePrice({ professionalFee: p.professionalFee, governmentFee: p.governmentFee, gstRate: p.gstRate }),
      })),
      related: related.map((r) => r.to).filter((r) => r.isActive && !r.deletedAt).map((item) => toCard(item)),
    };
  }

  /** Global search across services, published blog posts and categories; logs zero-result queries for the admin. */
  async search(query: string) {
    const q = query.trim();
    if (q.length < 2) return { services: [], posts: [], categories: [] };

    if (!this.searchCache || Date.now() - this.searchCache.at > 60_000) {
      const [rows, posts] = await Promise.all([
        this.prisma.service.findMany({ where: activeService, include: cardInclude }),
        this.prisma.blogPost.findMany({ where: { status: 'PUBLISHED', publishedAt: { lte: new Date() } }, select: { id: true, title: true, slug: true, excerpt: true, tags: { select: { name: true } }, categories: { select: { category: { select: { name: true } } } } } }),
      ]);
      this.searchCache = {
        at: Date.now(),
        services: rows.map((item) => toCard(item)).map((c) => ({ ...c, type: 'service' as const, extra: `${c.category.name} ${c.subcategory?.name ?? ''} ${c.shortDescription}` })),
        posts: posts.map((post) => ({ id: post.id, name: post.title, slug: post.slug, excerpt: post.excerpt, type: 'post' as const, popularity: 0, extra: `${post.excerpt ?? ''} ${post.tags.map((tag) => tag.name).join(' ')} ${post.categories.map(({ category }) => category.name).join(' ')}` })),
      };
    }
    const services = rank(this.searchCache.services, q, 8).map(({ extra: _e, ...c }) => c);
    const posts = rank(this.searchCache.posts, q, 8).map(({ id: _id, name: title, extra: _extra, popularity: _popularity, ...post }) => ({ ...post, title }));
    const cats = await this.prisma.category.findMany({ where: { isActive: true }, select: { slug: true, name: true, tagline: true } });
    const categories = rank(cats.map((c) => ({ ...c, id: c.slug, extra: c.tagline ?? '', popularity: 0 })), q, 3).map(({ slug, name }) => ({ slug, name }));

    if (!services.length && !posts.length && !categories.length) {
      await this.prisma.searchQuery.create({ data: { query: q.slice(0, 100), resultCount: 0 } });
    }
    return { services, posts, categories };
  }

  // ─────────────── Admin ───────────────

  private invalidate() {
    this.searchCache = undefined;
    this.publicCache.clear();
  }

  async createCategory(input: z.infer<typeof categoryInput>, actorId: string) {
    const c = await this.prisma.category.create({ data: input });
    await this.audit.log({ actorId, action: 'category.create', entityType: 'Category', entityId: c.id, after: c });
    await this.events.emit('catalogue.changed', { entityType: 'category' });
    return c;
  }

  async updateCategory(id: string, input: Partial<z.infer<typeof categoryInput>>, actorId: string) {
    const before = await this.prisma.category.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Category not found');
    const c = await this.prisma.category.update({ where: { id }, data: input });
    await this.audit.log({ actorId, action: 'category.update', entityType: 'Category', entityId: id, before, after: c });
    await this.events.emit('catalogue.changed', { entityType: 'category' });
    return c;
  }

  async createSubcategory(categoryId: string, input: z.infer<typeof subcategoryInput>, actorId: string) {
    const s = await this.prisma.subcategory.create({ data: { ...input, categoryId } });
    await this.audit.log({ actorId, action: 'subcategory.create', entityType: 'Subcategory', entityId: s.id, after: s });
    await this.events.emit('catalogue.changed', { entityType: 'subcategory' });
    return s;
  }

  /** Every category, active or not, with how many of its (non-deleted) services there are and how many are active. */
  async adminListCategories(): Promise<AdminCategoryRow[]> {
    const [cats, counts] = await Promise.all([
      this.prisma.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { subcategories: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, isActive: true } } },
      }),
      this.prisma.service.groupBy({ by: ['categoryId', 'isActive'], where: { deletedAt: null }, _count: { _all: true } }),
    ]);
    const count = (categoryId: string, active?: boolean) =>
      counts.filter((c) => c.categoryId === categoryId && (active === undefined || c.isActive === active)).reduce((n, c) => n + c._count._all, 0);
    return cats.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
      services: count(c.id),
      activeServices: count(c.id, true),
      subcategories: c.subcategories,
    }));
  }

  async adminListServices(includeInactive: boolean, categoryId?: string): Promise<AdminServiceRow[]> {
    const rows = await this.prisma.service.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }), ...(categoryId ? { categoryId } : {}) },
      orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      include: {
        category: { select: { id: true, name: true } },
        subcategory: { select: { name: true } },
        packages: { where: { isActive: true }, select: { professionalFee: true }, orderBy: { professionalFee: 'asc' } },
        _count: { select: { applications: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      isActive: s.isActive,
      isPopular: s.isPopular,
      category: s.category,
      subcategory: s.subcategory?.name ?? null,
      startingPrice: s.packages[0]?.professionalFee ?? null,
      activePackages: s.packages.length,
      applications: s._count.applications,
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  private async loadService(id: string) {
    const s = await this.prisma.service.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        packages: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { applications: true, orderItems: true } } } },
        documents: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { documents: true } } } },
        stages: { orderBy: { sortOrder: 'asc' }, include: { _count: { select: { history: true, current: true } } } },
        faqs: { orderBy: { sortOrder: 'asc' } },
        related: { select: { toId: true } },
      },
    });
    if (!s) throw new NotFoundException('Service not found');
    return s;
  }

  /** The service as the admin editor sees it, with "in use" flags for rows that cannot simply be deleted. */
  async adminGetService(id: string): Promise<AdminServiceDetail> {
    const s = await this.loadService(id);
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      categoryId: s.categoryId,
      category: s.category,
      subcategoryId: s.subcategoryId,
      shortDescription: s.shortDescription,
      overview: s.overview,
      icon: s.icon,
      imageUrl: s.imageUrl,
      benefits: s.benefits,
      estimatedTime: s.estimatedTime,
      estimatedDaysMin: s.estimatedDaysMin,
      estimatedDaysMax: s.estimatedDaysMax,
      sacCode: s.sacCode,
      popularity: s.popularity,
      isPopular: s.isPopular,
      isActive: s.isActive,
      recurrence: s.recurrence,
      reminderOffsets: s.reminderOffsets,
      seoTitle: s.seoTitle,
      metaDescription: s.metaDescription,
      updatedAt: s.updatedAt.toISOString(),
      packages: s.packages.map(({ _count, serviceId: _s, sortOrder: _o, createdAt: _c, updatedAt: _u, ...p }) => ({
        ...p,
        inUse: _count.applications + _count.orderItems > 0,
      })),
      documents: s.documents.map(({ _count, serviceId: _s, sortOrder: _o, ...d }) => ({ ...d, inUse: _count.documents > 0 })),
      stages: s.stages.map(({ _count, serviceId: _s, ...st }) => ({ ...st, inUse: _count.history + _count.current > 0 })),
      faqs: s.faqs.map(({ question, answer }) => ({ question, answer })),
      relatedServiceIds: s.related.map((r) => r.toId),
    };
  }

  private checkDays(input: { estimatedDaysMin?: number | null; estimatedDaysMax?: number | null }) {
    const { estimatedDaysMin: min, estimatedDaysMax: max } = input;
    if (min != null && max != null && min > max) {
      throw fieldError('estimatedDaysMax', 'Maximum days cannot be less than minimum days');
    }
  }

  /** Slug free (deleted services keep theirs), category exists, subcategory belongs to it. */
  private async checkServiceRefs(input: { slug?: string; categoryId?: string; subcategoryId?: string | null }, serviceId?: string) {
    if (input.slug) {
      const taken = await this.prisma.service.findFirst({ where: { slug: input.slug, ...(serviceId ? { id: { not: serviceId } } : {}) }, select: { deletedAt: true } });
      if (taken) {
        throw fieldError('slug', taken.deletedAt ? 'A removed service still uses this URL — choose another' : 'Another service already uses this URL', 409);
      }
    }
    if (input.categoryId && !(await this.prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) {
      throw fieldError('categoryId', 'Choose a category');
    }
    if (input.subcategoryId) {
      const sub = await this.prisma.subcategory.findUnique({ where: { id: input.subcategoryId }, select: { categoryId: true } });
      if (!sub || sub.categoryId !== input.categoryId) throw fieldError('subcategoryId', 'Choose a subcategory of the selected category');
    }
  }

  /** Related services must exist, not be deleted and not be the service itself. */
  private async checkRelated(ids: string[], serviceId?: string) {
    if (serviceId && ids.includes(serviceId)) throw fieldError('relatedServiceIds', 'A service cannot be related to itself');
    if (!ids.length) return;
    const found = await this.prisma.service.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw fieldError('relatedServiceIds', 'One of the related services no longer exists');
  }

  private checkPackages(items: z.infer<typeof packageInput>[]) {
    if (!items.some((p) => p.isActive)) throw fieldError('packages', 'Keep at least one active package');
    if (items.filter((p) => p.isMostPopular && p.isActive).length > 1) throw fieldError('packages', 'Only one package can be marked "Most popular"');
    const ids = items.flatMap((p) => (p.id ? [p.id] : []));
    if (new Set(ids).size !== ids.length) throw fieldError('packages', 'A package is listed twice');
  }

  /** Document → package restrictions must point at this service's packages. */
  private checkDocumentPackages(items: z.infer<typeof documentInput>[], packageIds: string[]) {
    const known = new Set(packageIds);
    items.forEach((d, i) => {
      if (d.packageIds.some((id) => !known.has(id))) throw fieldError(`documents.${i}.packageIds`, 'Pick packages of this service');
    });
  }

  async createService(input: CreateServiceInput, actorId: string) {
    this.checkDays(input);
    this.checkPackages(input.packages);
    // Packages may arrive with a client-generated id so documents in the same request can refer to them.
    const packages = input.packages.map((p) => ({ ...p, id: p.id ?? randomUUID() }));
    this.checkDocumentPackages(input.documents, packages.map((p) => p.id));
    await this.checkServiceRefs(input);
    await this.checkRelated(input.relatedServiceIds);
    const { documents, stages, faqs, relatedServiceIds, packages: _p, ...fields } = input;
    const created = await this.prisma.service.create({
      data: {
        ...fields,
        packages: { create: packages.map((p, i) => ({ ...p, sortOrder: i })) },
        documents: { create: documents.map(({ id: _id, ...d }, i) => ({ ...d, sortOrder: i })) },
        stages: { create: stages.map(({ id: _id, ...s }, i) => ({ ...s, sortOrder: i + 1 })) },
        faqs: { create: faqs.map((f, i) => ({ ...f, sortOrder: i })) },
        related: { create: relatedServiceIds.map((toId) => ({ toId })) },
      },
    });
    await this.audit.log({ actorId, action: 'service.create', entityType: 'Service', entityId: created.id, after: input });
    await this.events.emit('catalogue.changed', { entityType: 'service' });
    return this.adminGetService(created.id);
  }

  async updateService(id: string, input: z.infer<typeof updateServiceInput>, actorId: string) {
    const before = await this.adminGetService(id);
    this.checkDays({
      estimatedDaysMin: input.estimatedDaysMin !== undefined ? input.estimatedDaysMin : before.estimatedDaysMin,
      estimatedDaysMax: input.estimatedDaysMax !== undefined ? input.estimatedDaysMax : before.estimatedDaysMax,
    });
    if (input.slug !== undefined || input.categoryId !== undefined || input.subcategoryId !== undefined) {
      const categoryId = input.categoryId ?? before.categoryId;
      // Moving to another category without naming a subcategory drops the old one.
      let subcategoryId = input.subcategoryId;
      if (subcategoryId === undefined) subcategoryId = categoryId === before.categoryId ? before.subcategoryId : null;
      await this.checkServiceRefs({ slug: input.slug, categoryId, subcategoryId }, id);
      input = { ...input, subcategoryId };
    }
    await this.prisma.service.update({ where: { id }, data: input });
    const after = await this.adminGetService(id);
    await this.audit.log({ actorId, action: 'service.update', entityType: 'Service', entityId: id, before, after });
    await this.events.emit('catalogue.changed', { entityType: 'service' });
    return after;
  }

  /** Deactivate/delete never removes rows that orders depend on. */
  async removeService(id: string, actorId: string) {
    await this.loadService(id);
    const s = await this.prisma.service.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
    await this.audit.log({ actorId, action: 'service.delete', entityType: 'Service', entityId: id, after: { deletedAt: s.deletedAt } });
    await this.events.emit('catalogue.changed', { entityType: 'service' });
    return { message: 'Service removed from the catalogue' };
  }

  async replacePackages(serviceId: string, items: z.infer<typeof packageInput>[], actorId: string) {
    this.checkPackages(items);
    const before = await this.loadService(serviceId);
    await this.prisma.$transaction(async (tx) => {
      const keep = new Set(items.filter((p) => p.id).map((p) => p.id));
      const deleted: string[] = [];
      await inSequence(before.packages.filter((p) => !keep.has(p.id)), async (old) => {
        // Packages that orders or applications point at are only switched off.
        if (old._count.applications + old._count.orderItems > 0) {
          await tx.servicePackage.update({ where: { id: old.id }, data: { isActive: false } });
          return;
        }
        await tx.servicePackage.delete({ where: { id: old.id } });
        deleted.push(old.id);
      });
      await inSequence(items, ({ id, ...p }, i) =>
        id && before.packages.some((x) => x.id === id)
          ? tx.servicePackage.update({ where: { id }, data: { ...p, sortOrder: i } })
          : tx.servicePackage.create({ data: { ...p, ...(id ? { id } : {}), serviceId, sortOrder: i } }),
      );
      // Documents restricted to a deleted package no longer refer to it.
      await inSequence(before.documents.filter((d) => d.packageIds.some((p) => deleted.includes(p))), (d) =>
        tx.serviceDocumentRequirement.update({ where: { id: d.id }, data: { packageIds: d.packageIds.filter((p) => !deleted.includes(p)) } }),
      );
    });
    await this.audit.log({ actorId, action: 'service.packages.update', entityType: 'Service', entityId: serviceId, before: before.packages, after: items });
    await this.events.emit('catalogue.changed', { entityType: 'service' });
    return this.adminGetService(serviceId);
  }

  async replaceDocuments(serviceId: string, items: z.infer<typeof documentInput>[], actorId: string) {
    const before = await this.loadService(serviceId);
    this.checkDocumentPackages(items, before.packages.map((p) => p.id));
    await this.prisma.$transaction(async (tx) => {
      const keep = new Set(items.filter((d) => d.id).map((d) => d.id));
      await inSequence(before.documents.filter((d) => !keep.has(d.id)), (old) => {
        if (old._count.documents) throw new BadRequestException(`"${old.name}" is used by existing applications and can't be removed`);
        return tx.serviceDocumentRequirement.delete({ where: { id: old.id } });
      });
      await inSequence(items, ({ id, ...d }, i) =>
        id && before.documents.some((x) => x.id === id)
          ? tx.serviceDocumentRequirement.update({ where: { id }, data: { ...d, sortOrder: i } })
          : tx.serviceDocumentRequirement.create({ data: { ...d, serviceId, sortOrder: i } }),
      );
    });
    await this.audit.log({ actorId, action: 'service.documents.update', entityType: 'Service', entityId: serviceId, before: before.documents, after: items });
    await this.events.emit('catalogue.changed', { entityType: 'service' });
    return this.adminGetService(serviceId);
  }

  async replaceStages(serviceId: string, items: z.infer<typeof stageInput>[], actorId: string) {
    if (!items.length) throw new BadRequestException('Add at least one process stage');
    const before = await this.loadService(serviceId);
    await this.prisma.$transaction(async (tx) => {
      const keep = new Set(items.filter((s) => s.id).map((s) => s.id));
      await inSequence(before.stages.filter((s) => !keep.has(s.id)), (old) => {
        if (old._count.history + old._count.current > 0) throw new BadRequestException(`"${old.name}" is part of existing application timelines and can't be removed`);
        return tx.serviceStage.delete({ where: { id: old.id } });
      });
      // Move existing stages out of the way so the unique (serviceId, sortOrder) index allows reordering.
      await tx.serviceStage.updateMany({ where: { serviceId }, data: { sortOrder: { increment: 1000 } } });
      await inSequence(items, ({ id, ...s }, i) =>
        id && before.stages.some((x) => x.id === id)
          ? tx.serviceStage.update({ where: { id }, data: { ...s, sortOrder: i + 1 } })
          : tx.serviceStage.create({ data: { ...s, serviceId, sortOrder: i + 1 } }),
      );
    });
    await this.audit.log({ actorId, action: 'service.stages.update', entityType: 'Service', entityId: serviceId, before: before.stages, after: items });
    await this.events.emit('catalogue.changed', { entityType: 'service' });
    return this.adminGetService(serviceId);
  }

  async replaceFaqs(serviceId: string, items: z.infer<typeof faqInput>[], actorId: string) {
    const before = await this.loadService(serviceId);
    await this.prisma.$transaction([
      this.prisma.serviceFAQ.deleteMany({ where: { serviceId } }),
      this.prisma.serviceFAQ.createMany({ data: items.map((f, i) => ({ ...f, serviceId, sortOrder: i })) }),
    ]);
    await this.audit.log({ actorId, action: 'service.faqs.update', entityType: 'Service', entityId: serviceId, before: before.faqs, after: items });
    await this.events.emit('catalogue.changed', { entityType: 'service' });
    return this.adminGetService(serviceId);
  }

  async replaceRelated(serviceId: string, ids: string[], actorId: string) {
    const before = await this.loadService(serviceId);
    await this.checkRelated(ids, serviceId);
    await this.prisma.$transaction([
      this.prisma.serviceRelation.deleteMany({ where: { fromId: serviceId } }),
      this.prisma.serviceRelation.createMany({ data: ids.map((toId) => ({ fromId: serviceId, toId })) }),
    ]);
    await this.audit.log({
      actorId,
      action: 'service.related.update',
      entityType: 'Service',
      entityId: serviceId,
      before: before.related.map((r) => r.toId),
      after: ids,
    });
    await this.events.emit('catalogue.changed', { entityType: 'service' });
    return this.adminGetService(serviceId);
  }
}

/** A validation error on one field, in the same `{ message, errors[] }` shape as ZodPipe so forms can show it in place. */
function fieldError(field: string, message: string, status: 400 | 409 = 400) {
  const body = { message, errors: [{ field, message }] };
  return status === 409 ? new ConflictException(body) : new BadRequestException(body);
}
