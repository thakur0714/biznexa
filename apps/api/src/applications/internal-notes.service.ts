
import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth.decorators';
import { CreateInternalNoteInput, UpdateInternalNoteInput, InternalNote, PERMS } from '@biznexa/types';

@Injectable()
export class InternalNotesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async assertApplicationAccess(applicationId: string, u: AuthUser) {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId }, select: { assignedToId: true } });
    if (!app) throw new NotFoundException('Application not found');
    
    const canViewAll = u.permissions.includes(PERMS.APPLICATIONS_VIEW_ALL);
    if (!canViewAll) {
      if (!u.permissions.includes(PERMS.APPLICATIONS_VIEW_ASSIGNED) || app.assignedToId !== u.id) {
        throw new NotFoundException('Application not found');
      }
    }
    return app;
  }

  async list(applicationId: string, u: AuthUser): Promise<InternalNote[]> {
    await this.assertApplicationAccess(applicationId, u);
    const notes = await this.prisma.internalNote.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { name: true } } },
    });
    return notes.map((n) => ({
      id: n.id,
      applicationId: n.applicationId,
      content: n.body,
      authorId: n.authorId,
      authorName: n.author?.name ?? null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.createdAt.toISOString(),
    }));
  }

  async create(applicationId: string, body: CreateInternalNoteInput, u: AuthUser): Promise<InternalNote> {
    await this.assertApplicationAccess(applicationId, u);
    
    const note = await this.prisma.internalNote.create({
      data: {
        applicationId,
        authorId: u.id,
        body: body.content,
      },
      include: { author: { select: { name: true } } },
    });

    await this.audit.log({
      actorId: u.id,
      action: 'internal-note.create',
      entityType: 'InternalNote',
      entityId: note.id,
      before: null,
      after: { body: note.body },
    });

    return {
      id: note.id,
      applicationId: note.applicationId,
      content: note.body,
      authorId: note.authorId,
      authorName: note.author?.name ?? null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.createdAt.toISOString(),
    };
  }

  async update(applicationId: string, id: string, body: UpdateInternalNoteInput, u: AuthUser): Promise<InternalNote> {
    await this.assertApplicationAccess(applicationId, u);
    
    const existing = await this.prisma.internalNote.findUnique({ where: { id, applicationId } });
    if (!existing) throw new NotFoundException('Note not found');

    const canManageAll = u.permissions.includes(PERMS.APPLICATIONS_VIEW_ALL);
    if (!canManageAll && existing.authorId !== u.id) {
      throw new ForbiddenException('You can only edit your own notes');
    }

    const note = await this.prisma.internalNote.update({
      where: { id },
      data: { body: body.content },
      include: { author: { select: { name: true } } },
    });

    await this.audit.log({
      actorId: u.id,
      action: 'internal-note.update',
      entityType: 'InternalNote',
      entityId: note.id,
      before: { body: existing.body },
      after: { body: note.body },
    });

    return {
      id: note.id,
      applicationId: note.applicationId,
      content: note.body,
      authorId: note.authorId,
      authorName: note.author?.name ?? null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.createdAt.toISOString(),
    };
  }

  async remove(applicationId: string, id: string, u: AuthUser): Promise<void> {
    await this.assertApplicationAccess(applicationId, u);
    
    const existing = await this.prisma.internalNote.findUnique({ where: { id, applicationId } });
    if (!existing) throw new NotFoundException('Note not found');

    const canManageAll = u.permissions.includes(PERMS.APPLICATIONS_VIEW_ALL);
    if (!canManageAll && existing.authorId !== u.id) {
      throw new ForbiddenException('You can only delete your own notes');
    }

    await this.prisma.internalNote.delete({ where: { id } });

    await this.audit.log({
      actorId: u.id,
      action: 'internal-note.delete',
      entityType: 'InternalNote',
      entityId: id,
      before: { body: existing.body },
      after: null,
    });
  }
}
