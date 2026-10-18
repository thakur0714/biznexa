import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { blogPostInput, blogPostSchema, PERMS, type BlogPostInput } from '@biznexa/types';
import { AdminBlogService } from './blog.service';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { richTextInput } from '../cms/rich-text';

const uuid = new ParseUUIDPipe();
const postInput = blogPostInput.extend({ content: richTextInput });
@ApiTags('admin · blog')
@ApiBearerAuth()
@Controller('admin/blog/posts')
export class AdminBlogPostsController {
  constructor(private readonly blog: AdminBlogService) {}
  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('BlogPostList', z.array(blogPostSchema))
  @Get() list() { return this.blog.listPosts(); }
  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('BlogPost', blogPostSchema, 201)
  @Post() create(@ZodBody(postInput) body: BlogPostInput, @CurrentUser() u: AuthUser) { return this.blog.createPost(body, u); }
  @RequirePermissions(PERMS.CMS_MANAGE)
  @ApiZodResponse('BlogPost', blogPostSchema)
  @Put(':id') update(@Param('id', uuid) id: string, @ZodBody(postInput) body: BlogPostInput, @CurrentUser() u: AuthUser) { return this.blog.updatePost(id, body, u); }
  @RequirePermissions(PERMS.CMS_MANAGE)
  @Delete(':id') remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) { return this.blog.deletePost(id, u); }
}
