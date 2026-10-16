import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AdminTicketsController } from './admin-tickets.controller';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AuditModule],
  controllers: [TicketsController, AdminTicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
