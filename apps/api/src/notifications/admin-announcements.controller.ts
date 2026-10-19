import { Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { announcementCountInputSchema, announcementCountSchema, announcementSendInputSchema, announcementSendResponseSchema, type AnnouncementSendInput, PERMS } from '@biznexa/types';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { AdminAnnouncementsService } from './admin-announcements.service';

@ApiTags('admin · announcements')
@ApiBearerAuth()
@RequirePermissions(PERMS.SETTINGS_MANAGE)
@Controller('admin/notifications/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AdminAnnouncementsService) {}

  @ApiZodResponse('AnnouncementCount', announcementCountSchema)
  @Post('count')
  count(@ZodBody(announcementCountInputSchema) input: { segment: import('@biznexa/types').AnnouncementSegment }) {
    return this.announcements.count(input.segment);
  }

  @ApiZodResponse('AnnouncementSend', announcementSendResponseSchema, 201)
  @Post()
  send(@ZodBody(announcementSendInputSchema) body: AnnouncementSendInput, @CurrentUser() actor: AuthUser) {
    return this.announcements.send(body, actor.id);
  }
}
