import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { otpSenderProvider } from './otp-sender';

@Module({
  imports: [NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService, TwoFactorService, otpSenderProvider],
  exports: [TokenService],
})
export class AuthModule {}
