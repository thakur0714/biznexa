import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { APPLICATION_NOTE_MAX, APPLICATION_STATUS_LABEL, canTransition, type ApplicationStatus, type DomainEventPayloads } from '@biznexa/types';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';

export interface ApplicationTransition {
  applicationId: string;
  to: ApplicationStatus;
  /** Staff or customer making the change; null for the system (webhook, scheduler). */
  actorId: string | null;
  /** Shown on the timeline; required to cancel. */
  note?: string;
  /** False keeps the history row off the customer timeline (staff-only note). Default true. */
  visibleToCustomer?: boolean;
  ip?: string;
}

export type StatusChanged = DomainEventPayloads['application.status_changed'];

/**
 * The one way to change an application's status (M4.1, §6): checks the move against the shared state machine,
 * then writes the status, a history row and an audit entry in one transaction and emits
 * `application.status_changed` after it commits. The status is only updated if it is still the one that was
 * checked, so two staff changing the same application at once cannot both win (the second gets 409).
 *
 * Callers that already run a transaction use `transitionIn` and emit the returned event after their commit.
 */
@Injectable()
export class ApplicationStatusService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly events: EventBus) {}

  async transition(input: ApplicationTransition): Promise<StatusChanged> {
    const changed = await this.prisma.$transaction((tx) => this.transitionIn(tx, input));
    await this.events.emit('application.status_changed', changed);
    return changed;
  }

  async transitionIn(tx: Prisma.TransactionClient, input: ApplicationTransition): Promise<StatusChanged> {
    const { applicationId, to, actorId } = input;
    const note = input.note?.trim() || undefined;
    if (note && note.length > APPLICATION_NOTE_MAX) throw new BadRequestException(`Keep the note under ${APPLICATION_NOTE_MAX} characters`);
    if (to === 'CANCELLED' && !note) throw new BadRequestException('Enter the reason for cancelling');

    const app = await tx.application.findUnique({ where: { id: applicationId }, select: { id: true, status: true } });
    if (!app) throw new NotFoundException('Application not found');
    const from = app.status as ApplicationStatus;
    if (!canTransition('application', from, to)) {
      throw new ConflictException(`An application that is “${APPLICATION_STATUS_LABEL[from]}” cannot be moved to “${APPLICATION_STATUS_LABEL[to]}”`);
    }

    const updated = await tx.application.updateMany({
      where: { id: applicationId, status: from },
      data: { status: to, ...(to === 'COMPLETED' ? { completedAt: new Date() } : {}) },
    });
    if (updated.count === 0) throw new ConflictException('This application was changed by someone else just now. Reload and try again.');

    const visibleToCustomer = input.visibleToCustomer ?? true;
    await tx.applicationStageHistory.create({ data: { applicationId, status: to, note, visibleToCustomer, changedById: actorId } });
    await this.audit.log(
      { actorId, action: 'application.status_change', entityType: 'Application', entityId: applicationId, before: { status: from }, after: { status: to, note, visibleToCustomer }, ip: input.ip },
      tx,
    );
    return { applicationId, from, to, actorId, ...(note ? { reason: note } : {}) };
  }
}
