import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { ApplicationDocumentsController } from './application-documents.controller';
import { ApplicationDocumentsService } from './application-documents.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { OrderSummaryController } from './order-summary.controller';
import { OrderSummaryService } from './order-summary.service';

@Module({
  imports: [CouponsModule],
  controllers: [ApplicationsController, ApplicationDocumentsController, OrderSummaryController],
  providers: [ApplicationsService, ApplicationDocumentsService, OrderSummaryService],
  exports: [ApplicationsService, ApplicationDocumentsService, OrderSummaryService],
})
export class ApplicationsModule {}
