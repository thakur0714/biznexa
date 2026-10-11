import { Module } from '@nestjs/common';
import { AdminCertificatesController, PublicCertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  controllers: [PublicCertificatesController, AdminCertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
