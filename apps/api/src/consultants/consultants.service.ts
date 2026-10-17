import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  adminConsultantActionResponseSchema,
  adminConsultantDetailSchema,
  adminConsultantListSchema,
  adminConsultantSummarySchema,
  consultantApplicationResponseSchema,
  type AdminConsultantDetail,
  type AdminConsultantList,
  type AdminConsultantListQuery,
  type AdminConsultantProfileInput,
  type ConsultantApplicationInput,
  type ConsultantApplicationResponse,
  type ConsultantRejectInput,
} from '@biznexa/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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
          state: true, experienceYears: true, feePerSession: true, createdAt: true,
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
      },
    });
    if (!consultant) throw new NotFoundException('Consultant not found');
    return adminConsultantDetailSchema.parse({
      ...consultant,
      createdAt: consultant.createdAt.toISOString(),
      updatedAt: consultant.updatedAt.toISOString(),
      name: consultant.user.name,
      email: consultant.user.email,
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

  async approve(id: string, staffId: string) {
    return this.setStatus(id, 'APPROVED', null, staffId);
  }

  async reject(id: string, input: ConsultantRejectInput, staffId: string) {
    return this.setStatus(id, 'REJECTED', input.reason, staffId);
  }

  async suspend(id: string, staffId: string) {
    return this.setStatus(id, 'SUSPENDED', null, staffId);
  }

  private async setStatus(id: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED', reason: string | null, staffId: string) {
    const before = await this.prisma.consultant.findUnique({
      where: { id },
      select: {
        id: true, userId: true, verificationStatus: true, rejectionReason: true,
        user: { select: { roles: { where: { role: { key: 'CONSULTANT' } }, select: { roleId: true } } } },
      },
    });
    if (!before) throw new NotFoundException('Consultant not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const consultantRole = await tx.role.findUniqueOrThrow({ where: { key: 'CONSULTANT' }, select: { id: true } });
      const result = await tx.consultant.update({
        where: { id },
        data: { verificationStatus: status, rejectionReason: reason },
        select: { id: true, userId: true, verificationStatus: true, rejectionReason: true },
      });
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
}
