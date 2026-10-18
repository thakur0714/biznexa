import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth.decorators';
import { CreateBlogCategoryInput, UpdateBlogCategoryInput, CreateTagInput, UpdateTagInput } from '@biznexa/types';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class AdminBlogService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // --- Categories ---

  async listCategories() {
    return this.prisma.blogCategory.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(data: CreateBlogCategoryInput, u: AuthUser) {
    try {
      const category = await this.prisma.blogCategory.create({ data });
      this.audit.log({
        actorId: u.id,
        action: 'blog_category.created',
        entityType: 'BlogCategory',
        entityId: category.id,
        before: null,
        after: category,
      });
      return category;
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A category with this slug already exists');
      }
      throw e;
    }
  }

  async updateCategory(id: string, data: UpdateBlogCategoryInput, u: AuthUser) {
    const existing = await this.prisma.blogCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog category not found');

    try {
      const category = await this.prisma.blogCategory.update({
        where: { id },
        data,
      });
      this.audit.log({
        actorId: u.id,
        action: 'blog_category.updated',
        entityType: 'BlogCategory',
        entityId: category.id,
        before: existing,
        after: category,
      });
      return category;
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A category with this slug already exists');
      }
      throw e;
    }
  }

  async deleteCategory(id: string, u: AuthUser) {
    const existing = await this.prisma.blogCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog category not found');

    await this.prisma.blogCategory.delete({ where: { id } });
    this.audit.log({
      actorId: u.id,
      action: 'blog_category.deleted',
      entityType: 'BlogCategory',
      entityId: id,
      before: existing,
      after: null,
    });
  }

  // --- Tags ---

  async listTags() {
    return this.prisma.tag.findMany({ orderBy: { name: 'asc' } });
  }

  async createTag(data: CreateTagInput, u: AuthUser) {
    try {
      const tag = await this.prisma.tag.create({ data });
      this.audit.log({
        actorId: u.id,
        action: 'tag.created',
        entityType: 'Tag',
        entityId: tag.id,
        before: null,
        after: tag,
      });
      return tag;
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A tag with this slug already exists');
      }
      throw e;
    }
  }

  async updateTag(id: string, data: UpdateTagInput, u: AuthUser) {
    const existing = await this.prisma.tag.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tag not found');

    try {
      const tag = await this.prisma.tag.update({
        where: { id },
        data,
      });
      this.audit.log({
        actorId: u.id,
        action: 'tag.updated',
        entityType: 'Tag',
        entityId: tag.id,
        before: existing,
        after: tag,
      });
      return tag;
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A tag with this slug already exists');
      }
      throw e;
    }
  }

  async deleteTag(id: string, u: AuthUser) {
    const existing = await this.prisma.tag.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tag not found');

    await this.prisma.tag.delete({ where: { id } });
    this.audit.log({
      actorId: u.id,
      action: 'tag.deleted',
      entityType: 'Tag',
      entityId: id,
      before: existing,
      after: null,
    });
  }
}
