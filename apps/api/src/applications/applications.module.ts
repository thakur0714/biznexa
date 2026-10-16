import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { ApplicationDocumentsController } from './application-documents.controller';
import { ApplicationDocumentsService } from './application-documents.service';
import { ApplicationsController } from './applications.controller';
import { AdminApplicationDocumentsController } from './admin-application-documents.controller';
import { AdminApplicationDocumentsService } from './admin-application-documents.service';
import { AdminApplicationsController } from './admin-applications.controller';
import { AdminApplicationsService } from './admin-applications.service';
import { ApplicationStatusService } from './application-status.service';
import { ApplicationsService } from './applications.service';
import { OrderSummaryController } from './order-summary.controller';
import { OrderSummaryService } from './order-summary.service';
import { InternalNotesController } from './internal-notes.controller';
import { InternalNotesService } from './internal-notes.service';
import { DeliverablesController } from './deliverables.controller';
import { DeliverablesService } from './deliverables.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { CustomerDocumentsController } from './customer-documents.controller';
import { PendingActionsController } from './pending-actions.controller';
import { PendingActionsService } from './pending-actions.service';

@Module({
  imports: [CouponsModule, CertificatesModule],
  controllers: [
    AdminApplicationDocumentsController,
    AdminApplicationsController,
    ApplicationsController,
    ApplicationDocumentsController,
    OrderSummaryController,
    InternalNotesController,
    DeliverablesController,
    MessagesController,
    CustomerDocumentsController,
    PendingActionsController,
  ],
  providers: [
    AdminApplicationDocumentsService,
    AdminApplicationsService,
    ApplicationsService,
    ApplicationStatusService,
    ApplicationDocumentsService,
    OrderSummaryService,
    InternalNotesService,
    DeliverablesService,
    MessagesService,
    PendingActionsService,
  ],
  exports: [ApplicationsService, ApplicationStatusService, ApplicationDocumentsService, OrderSummaryService],
})
export class ApplicationsModule {}
