import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  type NotificationChannel,
  type UpdateNotificationTemplateInput,
  type AdminNotificationTemplate,
  type PreviewNotificationTemplateInput,
  type PreviewNotificationTemplateResponse,
  NOTIFICATION_EVENT_VARIABLES,
  getAllowedVariablesForEvent,
  getSampleVariablesForEvent,
  extractTemplateVariables,
  escapeHtml,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** A blank or missing value clears the field. */
const trimmedOrNull = (value: string | null | undefined) => value?.trim() || null;

@Injectable()
export class AdminNotificationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listTemplates(query?: { event?: string; channel?: NotificationChannel }): Promise<{ templates: AdminNotificationTemplate[] }> {
    const where: { event?: string; channel?: NotificationChannel } = {};
    if (query?.event) where.event = query.event;
    if (query?.channel) where.channel = query.channel;

    const rows = await this.prisma.notificationTemplate.findMany({
      where,
      orderBy: [{ event: 'asc' }, { channel: 'asc' }],
    });

    const templates: AdminNotificationTemplate[] = rows.map((r) => ({
      id: r.id,
      event: r.event,
      channel: r.channel,
      subject: r.subject,
      body: r.body,
      dltTemplateId: r.dltTemplateId,
      isActive: r.isActive,
      updatedAt: r.updatedAt.toISOString(),
      allowedVariables: getAllowedVariablesForEvent(r.event),
    }));

    return { templates };
  }

  async getTemplateById(id: string): Promise<AdminNotificationTemplate> {
    const row = await this.prisma.notificationTemplate.findUnique({
      where: { id },
    });
    if (!row) {
      throw new NotFoundException(`Notification template ${id} not found`);
    }

    return {
      id: row.id,
      event: row.event,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      dltTemplateId: row.dltTemplateId,
      isActive: row.isActive,
      updatedAt: row.updatedAt.toISOString(),
      allowedVariables: getAllowedVariablesForEvent(row.event),
    };
  }

  async updateTemplate(
    id: string,
    input: UpdateNotificationTemplateInput,
    actorId: string,
  ): Promise<AdminNotificationTemplate> {
    const existing = await this.prisma.notificationTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Notification template ${id} not found`);
    }

    if (input.body !== undefined && !input.body.trim()) {
      throw new BadRequestException('Template body cannot be empty');
    }

    const targetSubject = input.subject === undefined ? existing.subject : trimmedOrNull(input.subject);
    const targetBody = input.body !== undefined ? input.body.trim() : existing.body;

    const usedVariables = extractTemplateVariables(`${targetSubject ?? ''} ${targetBody}`);
    const allowed = getAllowedVariablesForEvent(existing.event);
    const disallowed = usedVariables.filter((v) => !allowed.includes(v));
    if (disallowed.length > 0) {
      throw new BadRequestException(
        `Template uses variable(s) not supported by event "${existing.event}": ${disallowed.join(', ')}. Allowed variables: ${allowed.join(', ')}`,
      );
    }

    const data: {
      subject?: string | null;
      body?: string;
      dltTemplateId?: string | null;
      isActive?: boolean;
    } = {};

    if (input.subject !== undefined) {
      data.subject = targetSubject;
    }
    if (input.body !== undefined) {
      data.body = targetBody;
    }
    if (input.dltTemplateId !== undefined) {
      data.dltTemplateId = trimmedOrNull(input.dltTemplateId);
    }
    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
    }

    const updated = await this.prisma.notificationTemplate.update({
      where: { id },
      data,
    });

    await this.audit.log({
      actorId,
      action: 'notification.template.update',
      entityType: 'NotificationTemplate',
      entityId: id,
      before: {
        subject: existing.subject,
        body: existing.body,
        dltTemplateId: existing.dltTemplateId,
        isActive: existing.isActive,
      },
      after: {
        subject: updated.subject,
        body: updated.body,
        dltTemplateId: updated.dltTemplateId,
        isActive: updated.isActive,
      },
    });

    return {
      id: updated.id,
      event: updated.event,
      channel: updated.channel,
      subject: updated.subject,
      body: updated.body,
      dltTemplateId: updated.dltTemplateId,
      isActive: updated.isActive,
      updatedAt: updated.updatedAt.toISOString(),
      allowedVariables: getAllowedVariablesForEvent(updated.event),
    };
  }

  previewTemplate(input: PreviewNotificationTemplateInput): PreviewNotificationTemplateResponse {
    const combinedText = `${input.subject ?? ''} ${input.body}`;
    const variableRegex = /{{\s*(\w+)\s*}}/g;

    const usedSet = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = variableRegex.exec(combinedText)) !== null) {
      usedSet.add(match[1]);
    }
    const variablesUsed = Array.from(usedSet);

    const defaultSamples = input.event ? getSampleVariablesForEvent(input.event) : {};
    const sampleVariables = {
      ...defaultSamples,
      ...input.sampleVariables,
    };

    const allowed = input.event ? getAllowedVariablesForEvent(input.event) : [];
    const unknownVariables = input.event
      ? variablesUsed.filter((v) => !allowed.includes(v))
      : [];

    const missingVariables = variablesUsed.filter((v) => sampleVariables[v] === undefined || sampleVariables[v] === null);

    const escape = input.channel === 'EMAIL';

    const renderSnippet = (text: string): string => {
      return text.replaceAll(/{{\s*(\w+)\s*}}/g, (_m, varName: string) => {
        const val = sampleVariables[varName];
        if (val === undefined || val === null) {
          return `{{${varName}}}`;
        }
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val as string | number | boolean);
        return escape ? escapeHtml(str) : str;
      });
    };

    const renderedSubject = input.subject !== undefined && input.subject !== null
      ? renderSnippet(input.subject)
      : undefined;
    const renderedBody = renderSnippet(input.body);

    return {
      renderedSubject,
      renderedBody,
      variablesUsed,
      missingVariables,
      unknownVariables,
    };
  }

  getEventVariables() {
    return NOTIFICATION_EVENT_VARIABLES;
  }
}
