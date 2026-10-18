import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { dashboardSummarySchema } from '@biznexa/types';
import { AuthUser, CurrentUser, CustomerOnly } from '../common/auth.decorators';
import { ApiZodResponse } from '../common/openapi';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@CustomerOnly()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @ApiZodResponse('DashboardSummary', dashboardSummarySchema)
  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.dashboard.summary(user.id);
  }
}
