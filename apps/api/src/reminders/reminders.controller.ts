import { Controller, Get, Request } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ReminderListResponse, reminderListResponseSchema } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('reminders')
@Controller('reminders')
export class RemindersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ description: 'List of scheduled reminders for the authenticated customer.' })
  async listReminders(@Request() req: { user: { id: string } }): Promise<ReminderListResponse> {
    const userId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const reminders = await this.prisma.reminder.findMany({
      where: {
        userId,
        status: 'SCHEDULED',
        dueDate: {
          gte: today,
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
      include: {
        businessEntity: true,
      },
    });

    return reminderListResponseSchema.parse({
      items: reminders.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        dueDate: r.dueDate.toISOString(),
        renewServiceSlug: r.renewServiceSlug,
        businessEntity: r.businessEntity ? { name: r.businessEntity.legalName } : null,
      })),
    });
  }
}
