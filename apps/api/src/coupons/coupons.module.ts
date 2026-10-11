import { Module } from '@nestjs/common';
import { AdminCouponsController } from './admin-coupons.controller';
import { AdminCouponsService } from './admin-coupons.service';
import { CouponsService } from './coupons.service';

@Module({
  controllers: [AdminCouponsController],
  providers: [CouponsService, AdminCouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
