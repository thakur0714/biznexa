import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DataExportsController, PrivacyController } from './privacy.controller';
import { DataExportService } from './data-export.service';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [AuthModule],
  controllers: [PrivacyController, DataExportsController],
  providers: [PrivacyService, DataExportService],
})
export class PrivacyModule {}
