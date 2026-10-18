import { Controller, Get, Post, Put, Delete, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminBlogService } from './blog.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { PERMS, blogCategorySchema, createBlogCategoryInput, updateBlogCategoryInput, type CreateBlogCategoryInput, type UpdateBlogCategoryInput } from '@biznexa/types';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { z } from 'zod';

const uuid = new ParseUUIDPipe();

@ApiTags('admin · blog')
@ApiBearerAuth()
@Controller('admin/blog/categories')
export class AdminBlogCategoriesController {
  constructor(private readonly blog: AdminBlogService) {}

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('BlogCategoryList', z.array(blogCategorySchema))
  @Get()
  async list() {
    return this.blog.listCategories();
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('BlogCategory', blogCategorySchema, 201)
  @Post()
  async create(@ZodBody(createBlogCategoryInput) body: CreateBlogCategoryInput, @CurrentUser() u: AuthUser) {
    return this.blog.createCategory(body, u);
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('BlogCategory', blogCategorySchema)
  @Put(':id')
  async update(@Param('id', uuid) id: string, @ZodBody(updateBlogCategoryInput) body: UpdateBlogCategoryInput, @CurrentUser() u: AuthUser) {
    return this.blog.updateCategory(id, body, u);
  }

  @RequirePermissions(PERMS.CMS_MANAGE)
  @Delete(':id')
  async remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.blog.deleteCategory(id, u);
  }
}
