import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { StaffUsersController } from './staff-users.controller';
import { StaffUsersService } from './staff-users.service';

@Module({ imports: [PrismaModule, AuthModule], controllers: [StaffUsersController], providers: [StaffUsersService] })
export class StaffUsersModule {}
