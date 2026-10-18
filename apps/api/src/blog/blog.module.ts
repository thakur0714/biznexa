import { Module } from '@nestjs/common';
import { AdminBlogService } from './blog.service';
import { AdminBlogCategoriesController } from './admin-categories.controller';
import { AdminBlogTagsController } from './admin-tags.controller';
import { AdminBlogPostsController } from './admin-posts.controller';
import { PublicBlogPostsController } from './public-posts.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [AdminBlogCategoriesController, AdminBlogTagsController, AdminBlogPostsController, PublicBlogPostsController],
  providers: [AdminBlogService],
})
export class BlogModule {}
