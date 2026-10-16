import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomersService } from './admin-customers.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminCustomersController],
  providers: [AdminCustomersService],
})
export class CustomersModule {}
