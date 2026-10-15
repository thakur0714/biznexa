import { Module } from '@nestjs/common';
import { AdminCertificatesController, CertificatesController, PublicCertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { CertificatePdfService } from './certificate-pdf.service';

@Module({
  controllers: [PublicCertificatesController, AdminCertificatesController, CertificatesController],
  providers: [CertificatesService, CertificatePdfService],
  exports: [CertificatesService, CertificatePdfService],
})
export class CertificatesModule {}
