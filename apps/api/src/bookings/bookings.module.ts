import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConsultantsModule } from '../consultants/consultants.module';
import { PaymentsModule } from '../payments/payments.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

/** Consultation bookings (M8.8): holds, the customer's bookings and paying for them. */
@Module({
  imports: [AuditModule, ConsultantsModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
