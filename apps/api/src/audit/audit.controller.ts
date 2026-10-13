import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { auditLogPageSchema, auditLogFilterSchema, type AuditLogFilter, PERMS } from '@biznexa/types';
import { RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { AuditService } from './audit.service';

@ApiTags('admin · audit')
@ApiBearerAuth()
@RequirePermissions(PERMS.AUDIT_VIEW)
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @ApiZodResponse('AuditLogPage', auditLogPageSchema)
  @Get()
  async list(@ZodQuery(auditLogFilterSchema) query: AuditLogFilter) {
    return this.audit.list(query);
  }
}
