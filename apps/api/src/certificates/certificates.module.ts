import { Module } from '@nestjs/common';
import { CaptchaModule } from '../captcha/captcha.module';
import { AdminCertificatesController, CertificatesController, PublicCertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { CertificatePdfService } from './certificate-pdf.service';

@Module({
  imports: [CaptchaModule],
  controllers: [PublicCertificatesController, AdminCertificatesController, CertificatesController],
  providers: [CertificatesService, CertificatePdfService],
  exports: [CertificatesService, CertificatePdfService],
})
export class CertificatesModule {}
