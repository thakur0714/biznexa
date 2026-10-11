import { Controller, Get, Module, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/auth.decorators';

/** Public read access to published CMS pages (About, Terms, Privacy, Refund Policy). Editing arrives with the admin CMS milestone. */
@ApiTags('cms')
@Public()
@Controller('cms')
export class CmsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('pages/:slug')
  async page(@Param('slug') slug: string) {
    const page = await this.prisma.cmsPage.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { slug: true, title: true, content: true, seoTitle: true, metaDescription: true, updatedAt: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  @Get('settings/public')
  async settings() {
    const keys = ['company.name', 'company.email', 'company.phone', 'home.stats'];
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}

@Module({ controllers: [CmsController] })
export class CmsModule {}
