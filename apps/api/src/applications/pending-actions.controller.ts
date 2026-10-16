import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { pendingActionsResponseSchema } from '@biznexa/types';
import { AuthUser, CurrentUser } from '../common/auth.decorators';
import { ApiZodResponse } from '../common/openapi';
import { PendingActionsService } from './pending-actions.service';

@ApiTags('pending actions')
@ApiBearerAuth()
@Controller('pending-actions')
export class PendingActionsController {
  constructor(private readonly pendingActions: PendingActionsService) {}

  @ApiZodResponse('PendingActionsResponse', pendingActionsResponseSchema)
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.pendingActions.listForCustomer(user.id);
  }
}
