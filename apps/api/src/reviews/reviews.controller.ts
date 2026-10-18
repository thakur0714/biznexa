import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminReviewListSchema,
  adminReviewQuerySchema,
  reviewInputSchema,
  reviewModerationInputSchema,
  customerReviewSchema,
  reviewViewSchema,
  type AdminReviewQuery,
  type ReviewInput,
  type ReviewModerationInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser, PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @ApiZodResponse('CustomerReview', customerReviewSchema)
  @Get('bookings/:id/review')
  getMine(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.reviews.getMine(user.id, id);
  }

  @ApiZodResponse('Review', reviewViewSchema, 201)
  @Post('bookings/:id/review')
  submit(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(reviewInputSchema) body: ReviewInput, @CurrentUser() user: AuthUser) {
    return this.reviews.submit(user.id, id, body);
  }

  @RequirePermissions(PERMS.CONSULTANTS_MANAGE)
  @ApiZodResponse('AdminReviewList', adminReviewListSchema)
  @Get('admin/reviews')
  list(@ZodQuery(adminReviewQuerySchema) query: AdminReviewQuery) {
    return this.reviews.listAdmin(query);
  }

  @RequirePermissions(PERMS.CONSULTANTS_MANAGE)
  @ApiZodResponse('ReviewModerationResult', reviewViewSchema)
  @Post('admin/reviews/:id/moderate')
  moderate(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(reviewModerationInputSchema) body: ReviewModerationInput, @CurrentUser() user: AuthUser) {
    return this.reviews.moderate(id, user.id, body);
  }
}
