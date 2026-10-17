import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DataExportsController, PrivacyController } from './privacy.controller';
import { DataExportService } from './data-export.service';
import { AdminPrivacyController } from './admin-privacy.controller';
import { AdminPrivacyService } from './admin-privacy.service';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [AuthModule],
  controllers: [PrivacyController, DataExportsController, AdminPrivacyController],
  providers: [PrivacyService, DataExportService, AdminPrivacyService],
})
export class PrivacyModule {}
