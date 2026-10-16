import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.service';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomersService } from './admin-customers.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminCustomersController],
  providers: [AdminCustomersService],
})
export class CustomersModule {}
