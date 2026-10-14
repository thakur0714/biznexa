import { Injectable } from '@nestjs/common';
import {
  type NotificationChannel,
  type RenderedNotification,
  escapeHtml,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';

export class TemplateNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateNotFoundError';
  }
}

export class MissingTemplateVariableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingTemplateVariableError';
  }
}

export interface RenderTemplateOptions {
  escapeHtmlValues: boolean;
  contextInfo?: string;
}

@Injectable()
export class TemplateEngineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Renders a string containing {{variable}} placeholders.
   * If any variable is missing or null, throws MissingTemplateVariableError.
   * If escapeHtmlValues is true, escapes HTML special characters in variable values.
   */
  renderString(
    templateStr: string,
    variables: Record<string, unknown>,
    options: RenderTemplateOptions,
  ): string {
    const missingVars = new Set<string>();

    const rendered = templateStr.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, varName: string) => {
      const val = variables[varName];
      if (val === undefined || val === null) {
        missingVars.add(varName);
        return '';
      }
      const strVal = String(val);
      return options.escapeHtmlValues ? escapeHtml(strVal) : strVal;
    });

    if (missingVars.size > 0) {
      const list = Array.from(missingVars).join(', ');
      const ctx = options.contextInfo ? ` for ${options.contextInfo}` : '';
      throw new MissingTemplateVariableError(`Missing required variable(s): ${list}${ctx}`);
    }

    // Safety check: ensure no unrendered {{variable}} remains
    if (/{{\s*([a-zA-Z0-9_]+)\s*}}/.test(rendered)) {
      throw new MissingTemplateVariableError(`Template contains unrendered placeholder${options.contextInfo ? ` for ${options.contextInfo}` : ''}`);
    }

    return rendered;
  }

  /**
   * Pure render of subject and body from template data.
   * Escapes HTML only for EMAIL channel. IN_APP is rendered as text by React,
   * while SMS, PUSH, and WHATSAPP are plain text.
   */
  render(
    template: {
      subject?: string | null;
      body: string;
      channel: NotificationChannel;
      event?: string;
    },
    variables: Record<string, unknown>,
  ): RenderedNotification {
    const escapeHtmlValues = template.channel === 'EMAIL';
    const contextInfo = template.event
      ? `event="${template.event}" channel="${template.channel}"`
      : `channel="${template.channel}"`;

    const renderedBody = this.renderString(template.body, variables, {
      escapeHtmlValues,
      contextInfo,
    });

    const renderedSubject = template.subject
      ? this.renderString(template.subject, variables, {
          escapeHtmlValues,
          contextInfo,
        })
      : undefined;

    return {
      subject: renderedSubject,
      body: renderedBody,
    };
  }

  /**
   * Fetches the template from Prisma by event and channel, and renders it.
   */
  async renderTemplate(
    event: string,
    channel: NotificationChannel,
    variables: Record<string, unknown>,
  ): Promise<RenderedNotification> {
    const template = await this.prisma.notificationTemplate.findUnique({
      where: { event_channel: { event, channel } },
    });

    if (!template) {
      throw new TemplateNotFoundError(
        `Notification template not found for event="${event}" channel="${channel}"`,
      );
    }

    if (!template.isActive) {
      throw new TemplateNotFoundError(
        `Notification template for event="${event}" channel="${channel}" is inactive`,
      );
    }

    return this.render(template, variables);
  }
}
