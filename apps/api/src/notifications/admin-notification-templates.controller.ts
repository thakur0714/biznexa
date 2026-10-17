import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
  updateNotificationTemplateInput,
  type UpdateNotificationTemplateInput,
  adminNotificationTemplateSchema,
  adminNotificationTemplateListSchema,
  previewNotificationTemplateInput,
  previewNotificationTemplateResponse,
  type PreviewNotificationTemplateInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser, PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { AdminNotificationTemplatesService } from './admin-notification-templates.service';

const uuid = new ParseUUIDPipe();

@ApiTags('admin · notifications')
@ApiBearerAuth()
@RequirePermissions(PERMS.SETTINGS_MANAGE)
@Controller('admin/notifications/templates')
export class AdminNotificationTemplatesController {
  constructor(private readonly service: AdminNotificationTemplatesService) {}

  @ApiZodResponse('AdminNotificationTemplateList', adminNotificationTemplateListSchema)
  @ApiQuery({ name: 'event', required: false, type: String })
  @ApiQuery({ name: 'channel', required: false, enum: NOTIFICATION_CHANNELS })
  @Get()
  list(
    @Query('event') event?: string,
    @Query('channel') channel?: NotificationChannel,
  ) {
    return this.service.listTemplates({ event, channel });
  }

  @Get('events')
  events() {
    return this.service.getEventVariables();
  }

  @ApiZodResponse('PreviewNotificationTemplateResponse', previewNotificationTemplateResponse)
  @Post('preview')
  preview(@ZodBody(previewNotificationTemplateInput) body: PreviewNotificationTemplateInput) {
    return this.service.previewTemplate(body);
  }

  @ApiZodResponse('AdminNotificationTemplate', adminNotificationTemplateSchema)
  @Get(':id')
  getById(@Param('id', uuid) id: string) {
    return this.service.getTemplateById(id);
  }

  @ApiZodResponse('AdminNotificationTemplate', adminNotificationTemplateSchema)
  @Put(':id')
  update(
    @Param('id', uuid) id: string,
    @ZodBody(updateNotificationTemplateInput) body: UpdateNotificationTemplateInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateTemplate(id, body, user.id);
  }
}
