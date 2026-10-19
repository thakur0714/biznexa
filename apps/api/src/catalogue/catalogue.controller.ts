import { Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CatalogueService } from './catalogue.service';
import { FormSchemasService } from './form-schemas.service';
import {
  adminServicesQuery,
  categoryInput,
  createServiceInput,
  CreateServiceInput,
  documentInput,
  faqInput,
  listServicesQuery,
  ListServicesQuery,
  packageInput,
  relatedServicesInput,
  stageInput,
  subcategoryInput,
  updateServiceInput,
} from './catalogue.schemas';
import { AuthUser, CurrentUser, PERMS, Public, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import { ZodPipe } from '../common/zod';
import {
  adminCategoryListSchema,
  adminServiceDetailSchema,
  adminServiceListSchema,
  catalogueSearchResponseSchema,
  formSchemaVersionListSchema,
  formSchemaVersionRef,
  formSchemaVersionSchema,
  saveFormSchemaInput,
  type FormSchemaVersionRef,
} from '@biznexa/types';

const Detail = () => ApiZodResponse('AdminServiceDetail', adminServiceDetailSchema);
const Created = () => ApiZodResponse('AdminServiceDetail', adminServiceDetailSchema, 201);
const Version = (status = 200) => ApiZodResponse('FormSchemaVersion', formSchemaVersionSchema, status);

@ApiTags('catalogue')
@Public()
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('categories')
  categories() {
    return this.catalogue.categories();
  }

  @Get('categories/:slug')
  category(@Param('slug') slug: string) {
    return this.catalogue.category(slug);
  }

  @Get('services')
  services(@ZodQuery(listServicesQuery) q: ListServicesQuery) {
    return this.catalogue.listServices(q);
  }

  @Get('popular')
  popular() {
    return this.catalogue.popular();
  }

  @Get('services/:slug')
  service(@Param('slug') slug: string) {
    return this.catalogue.serviceDetail(slug);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiZodResponse('CatalogueSearchResponse', catalogueSearchResponseSchema)
  @ApiQuery({ name: 'q', required: false, description: 'What the visitor typed (typos are fine)' })
  @Get('search')
  search(@Query('q') q = '') {
    return this.catalogue.search(String(q).slice(0, 100));
  }
}

const uuid = new ParseUUIDPipe();

@ApiTags('admin · catalogue')
@ApiBearerAuth()
@RequirePermissions(PERMS.SERVICES_MANAGE)
@Controller('admin/catalogue')
export class AdminCatalogueController {
  constructor(private readonly catalogue: CatalogueService, private readonly forms: FormSchemasService) {}

  @ApiZodResponse('AdminCategoryList', adminCategoryListSchema)
  @Get('categories')
  listCategories() {
    return this.catalogue.adminListCategories();
  }

  @Post('categories')
  createCategory(@ZodBody(categoryInput) body: z.infer<typeof categoryInput>, @CurrentUser() u: AuthUser) {
    return this.catalogue.createCategory(body, u.id);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id', uuid) id: string, @ZodBody(categoryInput.partial()) body: Partial<z.infer<typeof categoryInput>>, @CurrentUser() u: AuthUser) {
    return this.catalogue.updateCategory(id, body, u.id);
  }

  @Post('categories/:id/subcategories')
  createSubcategory(@Param('id', uuid) id: string, @ZodBody(subcategoryInput) body: z.infer<typeof subcategoryInput>, @CurrentUser() u: AuthUser) {
    return this.catalogue.createSubcategory(id, body, u.id);
  }

  @ApiZodResponse('AdminServiceList', adminServiceListSchema)
  @Get('services')
  list(@ZodQuery(adminServicesQuery) q: z.infer<typeof adminServicesQuery>) {
    return this.catalogue.adminListServices(q.includeInactive === 'true', q.categoryId);
  }

  @Detail()
  @Get('services/:id')
  get(@Param('id', uuid) id: string) {
    return this.catalogue.adminGetService(id);
  }

  @Created()
  @Post('services')
  create(@ZodBody(createServiceInput) body: CreateServiceInput, @CurrentUser() u: AuthUser) {
    return this.catalogue.createService(body, u.id);
  }

  @Detail()
  @Patch('services/:id')
  update(@Param('id', uuid) id: string, @ZodBody(updateServiceInput) body: z.infer<typeof updateServiceInput>, @CurrentUser() u: AuthUser) {
    return this.catalogue.updateService(id, body, u.id);
  }

  @Delete('services/:id')
  remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.catalogue.removeService(id, u.id);
  }

  @Detail()
  @Put('services/:id/packages')
  packages(@Param('id', uuid) id: string, @ZodBody(z.array(packageInput).min(1)) body: z.infer<typeof packageInput>[], @CurrentUser() u: AuthUser) {
    return this.catalogue.replacePackages(id, body, u.id);
  }

  @Detail()
  @Put('services/:id/documents')
  documents(@Param('id', uuid) id: string, @ZodBody(z.array(documentInput)) body: z.infer<typeof documentInput>[], @CurrentUser() u: AuthUser) {
    return this.catalogue.replaceDocuments(id, body, u.id);
  }

  @Detail()
  @Put('services/:id/stages')
  stages(@Param('id', uuid) id: string, @ZodBody(z.array(stageInput).min(1)) body: z.infer<typeof stageInput>[], @CurrentUser() u: AuthUser) {
    return this.catalogue.replaceStages(id, body, u.id);
  }

  @Detail()
  @Put('services/:id/faqs')
  faqs(@Param('id', uuid) id: string, @ZodBody(z.array(faqInput)) body: z.infer<typeof faqInput>[], @CurrentUser() u: AuthUser) {
    return this.catalogue.replaceFaqs(id, body, u.id);
  }

  @Detail()
  @Put('services/:id/related')
  related(@Param('id', uuid) id: string, @ZodBody(relatedServicesInput) body: string[], @CurrentUser() u: AuthUser) {
    return this.catalogue.replaceRelated(id, body, u.id);
  }

  // ─────────────── Application form versions (M3.3, D30) ───────────────

  @ApiZodResponse('FormSchemaVersionList', formSchemaVersionListSchema)
  @Get('services/:id/form-schemas')
  formVersions(@Param('id', uuid) id: string) {
    return this.forms.list(id);
  }

  @Version()
  @ApiParam({ name: 'version', description: '`current` (what new applications use), `latest` (highest number) or a version number' })
  @Get('services/:id/form-schemas/:version')
  formVersion(@Param('id', uuid) id: string, @Param('version', new ZodPipe(formSchemaVersionRef)) version: FormSchemaVersionRef) {
    return this.forms.get(id, version);
  }

  /** Always creates version N+1; existing versions are never changed. */
  @Version(201)
  @Post('services/:id/form-schemas')
  saveFormVersion(@Param('id', uuid) id: string, @ZodBody(saveFormSchemaInput) body: z.infer<typeof saveFormSchemaInput>, @CurrentUser() u: AuthUser) {
    return this.forms.save(id, body, u.id);
  }

  @Version()
  @HttpCode(200)
  @Post('services/:id/form-schemas/:version/activate')
  activateFormVersion(@Param('id', uuid) id: string, @Param('version', ParseIntPipe) version: number, @CurrentUser() u: AuthUser) {
    return this.forms.activate(id, version, u.id);
  }
}
