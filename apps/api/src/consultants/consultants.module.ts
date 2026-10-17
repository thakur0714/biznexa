import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AdminConsultantsController } from './admin-consultants.controller';
import { ConsultantsController } from './consultants.controller';
import { ConsultantsService } from './consultants.service';

@Module({
  imports: [AuditModule],
  controllers: [ConsultantsController, AdminConsultantsController],
  providers: [ConsultantsService],
  exports: [ConsultantsService],
})
export class ConsultantsModule {}
