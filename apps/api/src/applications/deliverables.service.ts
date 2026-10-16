import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth.decorators';
import { AddDeliverableInput, DeliverableList, Deliverable } from '@biznexa/types';
import { applicationScope } from './application-access';

@Injectable()
export class DeliverablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async addDeliverable(applicationId: string, input: AddDeliverableInput, u: AuthUser): Promise<Deliverable> {
    const scope = applicationScope(u);

    return this.prisma.$transaction(async (tx) => {
      const app = await tx.application.findFirst({
        where: { AND: [{ id: applicationId }, scope] },
      });
      if (!app) throw new NotFoundException('Application not found or access denied');

      if (app.status !== 'IN_PROGRESS' && app.status !== 'COMPLETED') {
        throw new ConflictException('Deliverables can only be added to applications that are IN_PROGRESS or COMPLETED');
      }

      const file = await tx.storedFile.findFirst({
        where: { id: input.fileId, ownerId: u.id },
      });

      if (!file) {
        throw new BadRequestException({ message: 'The file could not be found or you do not own it', errors: [{ field: 'fileId', message: 'The file could not be found or you do not own it' }] });
      }
      if (file.scanStatus === 'INFECTED') {
        throw new BadRequestException({ message: 'A virus was found in this file', errors: [{ field: 'fileId', message: 'A virus was found in this file' }] });
      }

      const usedInDeliverable = await tx.finalDeliverable.findFirst({ where: { fileKey: file.fileKey } });
      if (usedInDeliverable) {
        throw new BadRequestException({ message: 'This file is already used as a deliverable', errors: [{ field: 'fileId', message: 'This file is already used as a deliverable' }] });
      }

      const usedInDocument = await tx.applicationDocument.findFirst({ where: { fileKey: file.fileKey } });
      if (usedInDocument) {
        throw new BadRequestException({ message: 'This file is already used as a document', errors: [{ field: 'fileId', message: 'This file is already used as a document' }] });
      }

      const deliverable = await tx.finalDeliverable.create({
        data: {
          applicationId: app.id,
          title: input.title,
          fileKey: file.fileKey,
          fileName: file.originalName,
          uploadedById: u.id,
        },
      });

      await this.audit.log({
        actorId: u.id,
        action: 'deliverable.add',
        entityType: 'Application',
        entityId: app.id,
        after: { deliverableId: deliverable.id, title: deliverable.title, fileId: file.id },
      }, tx);

      return {
        id: deliverable.id,
        title: deliverable.title,
        fileId: file.id,
        fileName: deliverable.fileName,
        createdAt: deliverable.createdAt.toISOString(),
      };
    });
  }

  async listDeliverablesAdmin(applicationId: string, u: AuthUser): Promise<DeliverableList> {
    const scope = applicationScope(u);
    const app = await this.prisma.application.findFirst({
      where: { AND: [{ id: applicationId }, scope] },
    });
    if (!app) throw new NotFoundException('Application not found or access denied');

    const deliverables = await this.prisma.finalDeliverable.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });

    const fileKeys = deliverables.map((d) => d.fileKey);
    const files = await this.prisma.storedFile.findMany({
      where: { fileKey: { in: fileKeys } },
    });
    const fileIdByKey = new Map(files.map((f) => [f.fileKey, f.id]));

    return deliverables.map((d) => ({
      id: d.id,
      title: d.title,
      fileId: fileIdByKey.get(d.fileKey) || '',
      fileName: d.fileName,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  async listDeliverablesCustomer(id: string, u: AuthUser): Promise<DeliverableList> {
    const app = await this.prisma.application.findFirst({
      where: { id, customerId: u.id },
    });
    if (!app) throw new NotFoundException('Application not found');

    const deliverables = await this.prisma.finalDeliverable.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: 'desc' },
    });

    const fileKeys = deliverables.map((d) => d.fileKey);
    const files = await this.prisma.storedFile.findMany({
      where: { fileKey: { in: fileKeys } },
    });
    const fileIdByKey = new Map(files.map((f) => [f.fileKey, f.id]));

    return deliverables.map((d) => ({
      id: d.id,
      title: d.title,
      fileId: fileIdByKey.get(d.fileKey) || '',
      fileName: d.fileName,
      createdAt: d.createdAt.toISOString(),
    }));
  }
}
