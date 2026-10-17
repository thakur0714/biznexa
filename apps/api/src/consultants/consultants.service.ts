import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { consultantApplicationResponseSchema, type ConsultantApplicationInput, type ConsultantApplicationResponse } from '@biznexa/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConsultantsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
