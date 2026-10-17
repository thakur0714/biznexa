import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AdminConsultantsController } from './admin-consultants.controller';
import { ConsultantsController } from './consultants.controller';
import { PublicConsultantsController } from './public-consultants.controller';
import { ConsultantsService } from './consultants.service';
import { AvailabilityService } from './availability.service';
import { ConsultantAvailabilityController } from './consultant-availability.controller';

@Module({
  imports: [AuditModule],
  controllers: [ConsultantsController, AdminConsultantsController, PublicConsultantsController, ConsultantAvailabilityController],
  providers: [ConsultantsService, AvailabilityService],
  exports: [ConsultantsService, AvailabilityService],
})
export class ConsultantsModule {}
