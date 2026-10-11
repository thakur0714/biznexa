import { Module } from '@nestjs/common';
import { AdminCatalogueController, CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { FormSchemasService } from './form-schemas.service';

@Module({
  controllers: [CatalogueController, AdminCatalogueController],
  providers: [CatalogueService, FormSchemasService],
  exports: [CatalogueService],
})
export class CatalogueModule {}
