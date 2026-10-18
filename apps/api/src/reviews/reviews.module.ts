import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({ imports: [AuditModule], controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
