import { Module } from '@nestjs/common';
import { BusinessEntitiesController } from './business-entities.controller';
import { BusinessEntitiesService } from './business-entities.service';

@Module({
  controllers: [BusinessEntitiesController],
  providers: [BusinessEntitiesService],
  exports: [BusinessEntitiesService],
})
export class BusinessEntitiesModule {}
