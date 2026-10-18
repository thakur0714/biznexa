import { Controller, Get, Post, Put, Delete, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminBlogService } from './blog.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { PERMS, tagSchema, createTagInput, updateTagInput, type CreateTagInput, type UpdateTagInput } from '@biznexa/types';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { z } from 'zod';

const uuid = new ParseUUIDPipe();

@ApiTags('admin · blog')
@ApiBearerAuth()
@Controller('admin/blog/tags')
export class AdminBlogTagsController {
  constructor(private readonly blog: AdminBlogService) {}

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('TagList', z.array(tagSchema))
  @Get()
  async list() {
    return this.blog.listTags();
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('Tag', tagSchema, 201)
  @Post()
  async create(@ZodBody(createTagInput) body: CreateTagInput, @CurrentUser() u: AuthUser) {
    return this.blog.createTag(body, u);
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('Tag', tagSchema)
  @Put(':id')
  async update(@Param('id', uuid) id: string, @ZodBody(updateTagInput) body: UpdateTagInput, @CurrentUser() u: AuthUser) {
    return this.blog.updateTag(id, body, u);
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @Delete(':id')
  async remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.blog.deleteTag(id, u);
  }
}
