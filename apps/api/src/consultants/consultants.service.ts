import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  addDays,
  generateSlots,
  istDate,
  istInstant,
  adminConsultantActionResponseSchema,
  adminConsultantDetailSchema,
  adminConsultantListSchema,
  adminConsultantSummarySchema,
  consultantApplicationResponseSchema,
  consultantOwnProfileSchema,
  consultantFeeChangeRequestSchema,
  consultantFeeChangeActionResponseSchema,
  publicConsultantDirectorySchema,
  publicConsultantProfileSchema,
  type AdminConsultantDetail,
  type AdminConsultantList,
  type AdminConsultantListQuery,
  type AdminConsultantProfileInput,
  type ConsultantApplicationInput,
  type ConsultantApplicationResponse,
  type ConsultantRejectInput,
  type ConsultantOwnProfile,
  type ConsultantFeeChangeDecision,
  type PublicConsultantDirectory,
  type PublicConsultantDirectoryQuery,
  type PublicConsultantProfile,
} from '@biznexa/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { liveBookingWhere } from '../bookings/booking-holds';

@Injectable()
export class ConsultantsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async apply(userId: string, input: ConsultantApplicationInput): Promise<ConsultantApplicationResponse> {
    if (await this.prisma.consultant.findUnique({ where: { userId }, select: { id: true } })) {
      throw new ConflictException('You have already submitted a consultant application.');
    }
    const fileIds = [
      input.documents.qualificationProofId,
      input.documents.membershipProofId,
      input.documents.idProofId,
    ];
    if (new Set(fileIds).size !== fileIds.length) {
      throw new BadRequestException('Upload a separate file for each proof document.');
    }

    const files = await this.prisma.storedFile.findMany({
      where: {
        id: { in: fileIds },
        ownerId: userId,
        requirementId: null,
        document: null,
        consultantDocument: null,
        scanStatus: { not: 'INFECTED' },
      },
      select: { id: true },
    });
    if (files.length !== fileIds.length) {
      throw new BadRequestException('One or more proof files are unavailable. Upload the documents again.');
    }

    try {
      const consultant = await this.prisma.$transaction(async (tx) => {
        if (await tx.consultant.findUnique({ where: { userId }, select: { id: true } })) {
          throw new ConflictException('You have already submitted a consultant application.');
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
        const baseSlug = user.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'consultant';
        const created = await tx.consultant.create({
          data: {
            userId,
            slug: `${baseSlug}-${randomUUID().slice(0, 8)}`,
            category: input.category,
            qualification: input.qualification,
            membershipNo: input.membershipNo || null,
            experienceYears: input.experienceYears,
            expertise: input.expertise,
            languages: input.languages,
            city: input.city,
            state: input.state,
            area: input.area || null,
            bio: input.bio || null,
            feePerSession: input.feePerSession,
            consultationTypes: input.consultationTypes,
            documents: {
              create: [
                { kind: 'QUALIFICATION_PROOF', fileId: input.documents.qualificationProofId },
                { kind: 'MEMBERSHIP_PROOF', fileId: input.documents.membershipProofId },
                { kind: 'ID_PROOF', fileId: input.documents.idProofId },
              ],
            },
          },
          select: { id: true, verificationStatus: true },
        });
        return created;
      });
      return consultantApplicationResponseSchema.parse(consultant);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You have already submitted a consultant application.');
      }
      throw error;
    }
  }

  async listAdmin(query: AdminConsultantListQuery): Promise<AdminConsultantList> {
    const where: Prisma.ConsultantWhereInput = query.status ? { verificationStatus: query.status } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.consultant.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true, userId: true, category: true, verificationStatus: true, city: true,
          state: true, experienceYears: true, feePerSession: true, isFeatured: true, createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
      this.prisma.consultant.count({ where }),
    ]);
    return adminConsultantListSchema.parse({
      items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), name: row.user.name, email: row.user.email })),
      total,
      page: query.page,
      limit: query.limit,
    });
  }

  async getAdmin(id: string): Promise<AdminConsultantDetail> {
    const consultant = await this.prisma.consultant.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true } },
        documents: { include: { file: { select: { originalName: true, mimeType: true, scanStatus: true } } }, orderBy: { kind: 'asc' } },
        feeChangeRequests: { include: { decidedBy: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!consultant) throw new NotFoundException('Consultant not found');
    return adminConsultantDetailSchema.parse({
      ...consultant,
      createdAt: consultant.createdAt.toISOString(),
      updatedAt: consultant.updatedAt.toISOString(),
      name: consultant.user.name,
      email: consultant.user.email,
      feeChangeRequests: consultant.feeChangeRequests.map((request) => ({
        id: request.id,
        requestedFee: request.requestedFee,
        status: request.status,
        decisionReason: request.decisionReason,
        createdAt: request.createdAt.toISOString(),
        decidedAt: request.decidedAt?.toISOString() ?? null,
        decidedBy: request.decidedBy?.name ?? null,
      })),
      documents: consultant.documents.map(({ file, ...document }) => ({
        ...document,
        createdAt: document.createdAt.toISOString(),
        fileName: file.originalName,
        mimeType: file.mimeType,
        scanStatus: file.scanStatus,
      })),
    });
  }

  async updateAdminProfile(id: string, input: AdminConsultantProfileInput, staffId: string): Promise<AdminConsultantDetail> {
    const before = await this.prisma.consultant.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Consultant not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Consultant" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.consultant.findUniqueOrThrow({ where: { id }, select: { feePerSession: true } });
      if (input.feePerSession !== current.feePerSession && await tx.consultantFeeChangeRequest.findFirst({ where: { consultantId: id, status: 'PENDING' }, select: { id: true } })) {
        throw new ConflictException('Decide the pending fee change request before editing the consultant fee.');
      }
      const consultant = await tx.consultant.update({
        where: { id },
        data: {
          category: input.category,
          qualification: input.qualification,
          membershipNo: input.membershipNo || null,
          experienceYears: input.experienceYears,
          expertise: input.expertise,
          languages: input.languages,
          city: input.city,
          state: input.state,
          area: input.area || null,
          bio: input.bio || null,
          feePerSession: input.feePerSession,
          consultationTypes: input.consultationTypes,
        },
        select: {
          id: true, category: true, qualification: true, membershipNo: true, experienceYears: true,
          expertise: true, languages: true, city: true, state: true, area: true, bio: true,
          feePerSession: true, consultationTypes: true,
        },
      });
      await this.audit.log({
        actorId: staffId, action: 'consultant.profile.update', entityType: 'Consultant', entityId: id,
        before: this.profileAuditShape(before), after: consultant,
      }, tx);
      return consultant;
    });
    return this.getAdmin(updated.id);
  }

  async getOwnProfile(userId: string): Promise<ConsultantOwnProfile> {
    const consultant = await this.prisma.consultant.findFirst({
      where: { userId, verificationStatus: 'APPROVED' },
      select: {
        id: true, slug: true, category: true, qualification: true, membershipNo: true, experienceYears: true,
        expertise: true, languages: true, city: true, state: true, area: true, bio: true, feePerSession: true,
        consultationTypes: true,
        feeChangeRequests: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!consultant) throw new ForbiddenException('Only an approved consultant can edit their profile');
    const pending = consultant.feeChangeRequests[0];
    return consultantOwnProfileSchema.parse({
      ...consultant,
      pendingFeeRequest: pending ? consultantFeeChangeRequestSchema.parse({
        ...pending, createdAt: pending.createdAt.toISOString(), decidedAt: pending.decidedAt?.toISOString() ?? null,
      }) : null,
    });
  }

  async updateOwnProfile(userId: string, input: AdminConsultantProfileInput): Promise<ConsultantOwnProfile> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.consultant.findFirst({ where: { userId, verificationStatus: 'APPROVED' } });
      if (!before) throw new ForbiddenException('Only an approved consultant can edit their profile');
      await tx.$queryRaw`SELECT id FROM "Consultant" WHERE id = ${before.id} FOR UPDATE`;
      if (
        input.category !== before.category
        || input.qualification !== before.qualification
        || (input.membershipNo ?? null) !== before.membershipNo
      ) {
        throw new ConflictException('Contact support to change your category, qualification or membership number.');
      }
      const pending = await tx.consultantFeeChangeRequest.findFirst({ where: { consultantId: before.id, status: 'PENDING' }, select: { id: true } });
      if (pending && input.feePerSession !== before.feePerSession) {
        throw new ConflictException('Your fee change is awaiting admin review. You can still save other profile changes.');
      }
      const updated = await tx.consultant.update({
        where: { id: before.id },
        data: {
          category: input.category, qualification: input.qualification, membershipNo: input.membershipNo || null,
          experienceYears: input.experienceYears, expertise: input.expertise, languages: input.languages,
          city: input.city, state: input.state, area: input.area || null, bio: input.bio || null,
          consultationTypes: input.consultationTypes,
        },
        select: {
          id: true, category: true, qualification: true, membershipNo: true, experienceYears: true, expertise: true,
          languages: true, city: true, state: true, area: true, bio: true, feePerSession: true, consultationTypes: true,
        },
      });
      await this.audit.log({
        actorId: userId, action: 'consultant.profile.self_update', entityType: 'Consultant', entityId: before.id,
        before: this.profileAuditShape(before), after: { ...updated, feePerSession: before.feePerSession },
      }, tx);
      if (input.feePerSession !== before.feePerSession) {
        const request = await tx.consultantFeeChangeRequest.create({
          data: { consultantId: before.id, requestedFee: input.feePerSession },
          select: { id: true, requestedFee: true, status: true },
        });
        await this.audit.log({
          actorId: userId, action: 'consultant.fee_change.request', entityType: 'ConsultantFeeChangeRequest', entityId: request.id,
          before: { feePerSession: before.feePerSession }, after: { requestedFee: request.requestedFee, status: request.status },
        }, tx);
      }
    });
    return this.getOwnProfile(userId);
  }

  async decideFeeChange(consultantId: string, requestId: string, decision: 'APPROVED' | 'REJECTED', input: ConsultantFeeChangeDecision | null, staffId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Consultant" WHERE id = ${consultantId} FOR UPDATE`;
      const request = await tx.consultantFeeChangeRequest.findFirst({ where: { id: requestId, consultantId }, select: { id: true, requestedFee: true, status: true, decisionReason: true } });
      if (!request) throw new NotFoundException('Fee change request not found');
      if (request.status !== 'PENDING') throw new ConflictException('This fee change request has already been decided.');
      const consultant = await tx.consultant.findUniqueOrThrow({ where: { id: consultantId }, select: { feePerSession: true } });
      const reason = decision === 'REJECTED' ? input?.reason ?? null : null;
      const update = await tx.consultantFeeChangeRequest.updateMany({
        where: { id: requestId, consultantId, status: 'PENDING' },
        data: { status: decision, decisionReason: reason, decidedAt: new Date(), decidedById: staffId },
      });
      if (update.count !== 1) throw new ConflictException('This fee change request was decided while you were reviewing it. Reload and try again.');
      if (decision === 'APPROVED') await tx.consultant.update({ where: { id: consultantId }, data: { feePerSession: request.requestedFee } });
      await this.audit.log({
        actorId: staffId,
        action: `consultant.fee_change.${decision.toLowerCase()}`,
        entityType: 'ConsultantFeeChangeRequest', entityId: requestId,
        before: { status: request.status, currentFee: consultant.feePerSession, requestedFee: request.requestedFee },
        after: { status: decision, currentFee: decision === 'APPROVED' ? request.requestedFee : consultant.feePerSession, requestedFee: request.requestedFee, reason },
      }, tx);
      return { id: request.id, consultantId, requestedFee: request.requestedFee, status: decision, decisionReason: reason };
    });
    return consultantFeeChangeActionResponseSchema.parse(result);
  }

  async approve(id: string, staffId: string) {
    return this.setStatus(id, 'APPROVED', null, staffId);
  }

  async reject(id: string, input: ConsultantRejectInput, staffId: string) {
    return this.setStatus(id, 'REJECTED', input.reason, staffId);
  }

  async suspend(id: string, staffId: string) {
    return this.setStatus(id, 'SUSPENDED', null, staffId);
  }

  async setFeatured(id: string, isFeatured: boolean, staffId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.consultant.findUnique({
        where: { id },
        select: { id: true, verificationStatus: true, isFeatured: true },
      });
      if (!before) throw new NotFoundException('Consultant not found');
      if (before.verificationStatus !== 'APPROVED') {
        throw new ConflictException('Only approved consultants can be featured.');
      }
      const update = await tx.consultant.updateMany({
        where: { id, verificationStatus: 'APPROVED' },
        data: { isFeatured },
      });
      if (update.count !== 1) {
        throw new ConflictException('Consultant status changed while this action was being processed. Reload and try again.');
      }
      await this.audit.log({
        actorId: staffId,
        action: 'consultant.featured',
        entityType: 'Consultant', entityId: id,
        before: { isFeatured: before.isFeatured },
        after: { isFeatured },
      }, tx);
      return { id, isFeatured };
    });
    return updated;
  }

  private async setStatus(id: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED', reason: string | null, staffId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.consultant.findUnique({
        where: { id },
        select: {
          id: true, userId: true, verificationStatus: true, rejectionReason: true,
          user: { select: { roles: { where: { role: { key: 'CONSULTANT' } }, select: { roleId: true } } } },
        },
      });
      if (!before) throw new NotFoundException('Consultant not found');
      const allowedFrom: Record<typeof status, readonly string[]> = {
        APPROVED: ['PENDING', 'REJECTED', 'SUSPENDED'],
        REJECTED: ['PENDING'],
        SUSPENDED: ['APPROVED'],
      };
      if (!allowedFrom[status].includes(before.verificationStatus)) {
        throw new ConflictException(`Cannot ${status.toLowerCase()} a consultant with status ${before.verificationStatus}.`);
      }
      const consultantRole = await tx.role.findUniqueOrThrow({ where: { key: 'CONSULTANT' }, select: { id: true } });
      const update = await tx.consultant.updateMany({
        where: { id, verificationStatus: before.verificationStatus },
        data: { verificationStatus: status, rejectionReason: reason },
      });
      if (update.count !== 1) {
        throw new ConflictException('Consultant status changed while this action was being processed. Reload and try again.');
      }
      const result = { id, userId: before.userId, verificationStatus: status, rejectionReason: reason };
      if (status === 'APPROVED') {
        await tx.userRole.createMany({ data: [{ userId: before.userId, roleId: consultantRole.id }], skipDuplicates: true });
      } else {
        await tx.userRole.deleteMany({ where: { userId: before.userId, roleId: consultantRole.id } });
      }
      await this.audit.log({
        actorId: staffId,
        action: `consultant.${status.toLowerCase()}`,
        entityType: 'Consultant', entityId: id,
        before: { verificationStatus: before.verificationStatus, rejectionReason: before.rejectionReason, consultantRoleGranted: before.user.roles.length > 0 },
        after: { verificationStatus: status, rejectionReason: reason, consultantRoleGranted: status === 'APPROVED' },
      }, tx);
      return result;
    });
    return adminConsultantActionResponseSchema.parse(updated);
  }

  private profileAuditShape(consultant: {
    category: string; qualification: string; membershipNo: string | null; experienceYears: number;
    expertise: string[]; languages: string[]; city: string; state: string; area: string | null;
    bio: string | null; feePerSession: number; consultationTypes: string[];
  }) {
    return {
      category: consultant.category, qualification: consultant.qualification, membershipNo: consultant.membershipNo,
      experienceYears: consultant.experienceYears, expertise: consultant.expertise, languages: consultant.languages,
      city: consultant.city, state: consultant.state, area: consultant.area, bio: consultant.bio,
      feePerSession: consultant.feePerSession, consultationTypes: consultant.consultationTypes,
    };
  }

  async listPublic(query: PublicConsultantDirectoryQuery, now = new Date()): Promise<PublicConsultantDirectory> {
    const today = istDate(now);
    const todayStart = istInstant(today, 0);
    const tomorrowStart = istInstant(addDays(today, 1), 0);
    const where: Prisma.ConsultantWhereInput = {
      verificationStatus: 'APPROVED',
      ...(query.category ? { category: query.category } : {}),
      ...(query.state ? { state: { equals: query.state, mode: 'insensitive' } } : {}),
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      ...(query.area ? { area: { equals: query.area, mode: 'insensitive' } } : {}),
      ...(query.minRating !== undefined ? { rating: { gte: query.minRating } } : {}),
      ...(query.minExperience !== undefined ? { experienceYears: { gte: query.minExperience } } : {}),
      ...(query.minFee !== undefined || query.maxFee !== undefined ? {
        feePerSession: {
          ...(query.minFee !== undefined ? { gte: query.minFee } : {}),
          ...(query.maxFee !== undefined ? { lte: query.maxFee } : {}),
        },
      } : {}),
      ...(query.language ? { languages: { has: query.language } } : {}),
      ...(query.consultationType ? { consultationTypes: { has: query.consultationType } } : {}),
      ...(query.featured !== undefined ? { isFeatured: query.featured } : {}),
    };
    const orderBy: Prisma.ConsultantOrderByWithRelationInput[] = query.sort === 'experience'
      ? [{ experienceYears: 'desc' }, { rating: 'desc' }, { id: 'asc' }]
      : query.sort === 'fee_low'
        ? [{ feePerSession: 'asc' }, { rating: 'desc' }, { id: 'asc' }]
        : query.sort === 'fee_high'
          ? [{ feePerSession: 'desc' }, { rating: 'desc' }, { id: 'asc' }]
          : [{ rating: 'desc' }, { reviewCount: 'desc' }, { id: 'asc' }];

    const select = {
      id: true, slug: true, category: true, qualification: true, city: true, state: true, area: true,
      expertise: true, languages: true, bio: true, photoUrl: true, feePerSession: true,
      sessionMinutes: true, consultationTypes: true, rating: true, reviewCount: true, isOnline: true, isFeatured: true,
      user: { select: { name: true } },
    } satisfies Prisma.ConsultantSelect;
    let rows: (Prisma.ConsultantGetPayload<{ select: typeof select }> & { availableToday: boolean })[];
    let total: number;
    if (query.availableToday !== undefined) {
      const candidates = await this.prisma.consultant.findMany({
        where,
        orderBy,
        select: {
          ...select,
          sessionMinutes: true,
          bufferMinutes: true,
          minNoticeMinutes: true,
          availability: {
            where: { OR: [{ weekday: { not: null } }, { date: new Date(`${today}T00:00:00Z`) }] },
            select: { weekday: true, date: true, startTime: true, endTime: true, isBlocked: true },
          },
        },
      });
      const bookings = candidates.length ? await this.prisma.booking.findMany({
        where: { consultantId: { in: candidates.map((c) => c.id) }, startAt: { lt: tomorrowStart }, endAt: { gt: todayStart }, ...liveBookingWhere(now) },
        select: { consultantId: true, startAt: true, endAt: true },
      }) : [];
      const busyByConsultant = new Map<string, { startAt: Date; endAt: Date }[]>();
      for (const booking of bookings) busyByConsultant.set(booking.consultantId, [...(busyByConsultant.get(booking.consultantId) ?? []), booking]);
      const available = candidates.map((c) => {
        const slots = generateSlots({
          sessionMinutes: c.sessionMinutes,
          bufferMinutes: c.bufferMinutes,
          minNoticeMinutes: c.minNoticeMinutes,
          weekly: c.availability.filter((s) => s.weekday !== null).map((s) => ({ weekday: s.weekday!, startTime: s.startTime, endTime: s.endTime })),
          exceptions: c.availability.filter((s) => s.date !== null).map((s) => ({ date: s.date!.toISOString().slice(0, 10), startTime: s.startTime, endTime: s.endTime, isBlocked: s.isBlocked })),
        }, { from: today, to: today, now, busy: busyByConsultant.get(c.id) ?? [] }).length > 0;
        const { availability: _availability, bufferMinutes: _bufferMinutes, minNoticeMinutes: _minNoticeMinutes, ...row } = c;
        return { ...row, availableToday: slots };
      }).filter((c) => c.availableToday === query.availableToday);
      total = available.length;
      rows = available.slice((query.page - 1) * query.limit, query.page * query.limit);
    } else {
      const [pageRows, count] = await this.prisma.$transaction([
        this.prisma.consultant.findMany({
          where, orderBy, skip: (query.page - 1) * query.limit, take: query.limit,
          select: {
            ...select,
            sessionMinutes: true,
            bufferMinutes: true,
            minNoticeMinutes: true,
            availability: {
              where: { OR: [{ weekday: { not: null } }, { date: new Date(`${today}T00:00:00Z`) }] },
              select: { weekday: true, date: true, startTime: true, endTime: true, isBlocked: true },
            },
          },
        }),
        this.prisma.consultant.count({ where }),
      ]);
      const bookings = pageRows.length ? await this.prisma.booking.findMany({
        where: { consultantId: { in: pageRows.map((c) => c.id) }, startAt: { lt: tomorrowStart }, endAt: { gt: todayStart }, ...liveBookingWhere(now) },
        select: { consultantId: true, startAt: true, endAt: true },
      }) : [];
      const busyByConsultant = new Map<string, { startAt: Date; endAt: Date }[]>();
      for (const booking of bookings) busyByConsultant.set(booking.consultantId, [...(busyByConsultant.get(booking.consultantId) ?? []), booking]);
      rows = pageRows.map((c) => {
        const availableToday = generateSlots({
          sessionMinutes: c.sessionMinutes,
          bufferMinutes: c.bufferMinutes,
          minNoticeMinutes: c.minNoticeMinutes,
          weekly: c.availability.filter((s) => s.weekday !== null).map((s) => ({ weekday: s.weekday!, startTime: s.startTime, endTime: s.endTime })),
          exceptions: c.availability.filter((s) => s.date !== null).map((s) => ({ date: s.date!.toISOString().slice(0, 10), startTime: s.startTime, endTime: s.endTime, isBlocked: s.isBlocked })),
        }, { from: today, to: today, now, busy: busyByConsultant.get(c.id) ?? [] }).length > 0;
        const { availability: _availability, bufferMinutes: _bufferMinutes, minNoticeMinutes: _minNoticeMinutes, ...row } = c;
        return { ...row, availableToday };
      });
      total = count;
    }
    return publicConsultantDirectorySchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.user.name,
        category: row.category,
        qualification: row.qualification,
        city: row.city,
        state: row.state,
        area: row.area,
        expertise: row.expertise,
        languages: row.languages,
        bio: row.bio,
        photoUrl: row.photoUrl,
        feePerSession: row.feePerSession,
        sessionMinutes: row.sessionMinutes,
        consultationTypes: row.consultationTypes,
        rating: row.rating,
        reviewCount: row.reviewCount,
        isOnline: row.isOnline,
        availableToday: row.availableToday,
        isFeatured: row.isFeatured,
      })),
      total,
      page: query.page,
      limit: query.limit,
    });
  }

  async getPublic(slug: string): Promise<PublicConsultantProfile> {
    const consultant = await this.prisma.consultant.findFirst({
      where: { slug, verificationStatus: 'APPROVED' },
      select: {
        id: true, slug: true, category: true, qualification: true, experienceYears: true, expertise: true,
        languages: true, city: true, state: true, area: true, bio: true, photoUrl: true, feePerSession: true,
        sessionMinutes: true, consultationTypes: true, rating: true, reviewCount: true, isOnline: true, isFeatured: true,
        user: { select: { name: true } },
        services: {
          where: { service: { isActive: true, deletedAt: null } },
          orderBy: { service: { name: 'asc' } },
          select: { service: { select: { id: true, slug: true, name: true, category: { select: { name: true } } } } },
        },
      },
    });
    if (!consultant) throw new NotFoundException('Consultant not found');
    const ratings = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { consultantId: consultant.id, status: 'APPROVED' },
      _count: { _all: true },
    });
    const verifiedReviews = await this.prisma.review.findMany({
      where: { consultantId: consultant.id, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, rating: true, text: true, createdAt: true },
    });
    const breakdown = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const rating of ratings) breakdown[String(rating.rating) as keyof typeof breakdown] = rating._count._all;
    return publicConsultantProfileSchema.parse({
      id: consultant.id,
      slug: consultant.slug,
      name: consultant.user.name,
      category: consultant.category,
      qualification: consultant.qualification,
      experienceYears: consultant.experienceYears,
      expertise: consultant.expertise,
      languages: consultant.languages,
      city: consultant.city,
      state: consultant.state,
      area: consultant.area,
      bio: consultant.bio,
      photoUrl: consultant.photoUrl,
      feePerSession: consultant.feePerSession,
      sessionMinutes: consultant.sessionMinutes,
      consultationTypes: consultant.consultationTypes,
      rating: consultant.rating,
      reviewCount: consultant.reviewCount,
      isOnline: consultant.isOnline,
      isFeatured: consultant.isFeatured,
      ratingSummary: {
        average: consultant.rating,
        reviewCount: consultant.reviewCount,
        breakdown,
      },
      services: consultant.services.map(({ service }) => ({ ...service, category: service.category.name })),
      verifiedReviews: verifiedReviews.map((review) => ({ ...review, createdAt: review.createdAt.toISOString() })),
    });
  }
}
