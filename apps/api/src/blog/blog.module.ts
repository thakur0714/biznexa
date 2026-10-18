import { Module } from '@nestjs/common';
import { AdminBlogService } from './blog.service';
import { AdminBlogCategoriesController } from './admin-categories.controller';
import { AdminBlogTagsController } from './admin-tags.controller';

@Module({
  controllers: [AdminBlogCategoriesController, AdminBlogTagsController],
  providers: [AdminBlogService],
})
export class BlogModule {}
