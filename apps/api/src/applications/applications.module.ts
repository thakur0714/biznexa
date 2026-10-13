import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { ApplicationDocumentsController } from './application-documents.controller';
import { ApplicationDocumentsService } from './application-documents.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { OrderSummaryController } from './order-summary.controller';
import { OrderSummaryService } from './order-summary.service';
import { InternalNotesController } from './internal-notes.controller';
import { InternalNotesService } from './internal-notes.service';

@Module({
  imports: [CouponsModule],
  controllers: [ApplicationsController, ApplicationDocumentsController, OrderSummaryController, InternalNotesController],
  providers: [ApplicationsService, ApplicationDocumentsService, OrderSummaryService, InternalNotesService],
  exports: [ApplicationsService, ApplicationDocumentsService, OrderSummaryService],
})
export class ApplicationsModule {}
