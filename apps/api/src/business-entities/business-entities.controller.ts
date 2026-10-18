import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { businessEntityInput, businessEntityListSchema, businessEntitySchema, type BusinessEntityData } from '@biznexa/types';
import { AuthUser, CurrentUser, CustomerOnly } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { BusinessEntitiesService } from './business-entities.service';

const uuid = new ParseUUIDPipe();
const Entity = (status = 200) => ApiZodResponse('BusinessEntity', businessEntitySchema, status);
const NotFound = () => ApiResponse({ status: 404, description: 'No such business among yours (another customer’s business looks the same)' });

/** The signed-in customer's own businesses; nobody else's are reachable here. */
@ApiTags('business entities')
@ApiBearerAuth()
@CustomerOnly()
@Controller('business-entities')
export class BusinessEntitiesController {
  constructor(private readonly entities: BusinessEntitiesService) {}

  @ApiZodResponse('BusinessEntityList', businessEntityListSchema)
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.entities.list(u.id);
  }

  @Entity(201)
  @ApiResponse({ status: 409, description: 'A business with this GSTIN is already saved' })
  @Post()
  create(@ZodBody(businessEntityInput) body: BusinessEntityData, @CurrentUser() u: AuthUser) {
    return this.entities.create(u.id, body);
  }

  @Entity()
  @NotFound()
  @Get(':id')
  get(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.entities.get(u.id, id);
  }

  @Entity()
  @NotFound()
  @ApiResponse({ status: 409, description: 'Another saved business has this GSTIN' })
  @Put(':id')
  update(@Param('id', uuid) id: string, @ZodBody(businessEntityInput) body: BusinessEntityData, @CurrentUser() u: AuthUser) {
    return this.entities.update(u.id, id, body);
  }

  @NotFound()
  @Delete(':id')
  remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.entities.remove(u.id, id);
  }
}
