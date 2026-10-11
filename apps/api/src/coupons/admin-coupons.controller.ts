import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adminCouponListSchema,
  adminCouponRowSchema,
  couponServiceOptionsSchema,
  createCouponInput,
  updateCouponInput,
  type CreateCouponInput,
  type UpdateCouponInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser, PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { AdminCouponsService } from './admin-coupons.service';

const uuid = new ParseUUIDPipe();
const Row = (status = 200) => ApiZodResponse('AdminCouponRow', adminCouponRowSchema, status);

/** Coupon CRUD with usage stats (M3.12, D39). */
@ApiTags('admin · coupons')
@ApiBearerAuth()
@RequirePermissions(PERMS.COUPONS_MANAGE)
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly coupons: AdminCouponsService) {}

  @ApiZodResponse('AdminCouponList', adminCouponListSchema)
  @Get()
  list() {
    return this.coupons.list();
  }

  /** Services a coupon can be limited to (for the editor's picker). */
  @ApiZodResponse('CouponServiceOptions', couponServiceOptionsSchema)
  @Get('services')
  services() {
    return this.coupons.serviceOptions();
  }

  @Row()
  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.coupons.get(id);
  }

  @Row(201)
  @Post()
  create(@ZodBody(createCouponInput) body: CreateCouponInput, @CurrentUser() u: AuthUser) {
    return this.coupons.create(body, u.id);
  }

  @Row()
  @Patch(':id')
  update(@Param('id', uuid) id: string, @ZodBody(updateCouponInput) body: UpdateCouponInput, @CurrentUser() u: AuthUser) {
    return this.coupons.update(id, body, u.id);
  }

  /** Only coupons no order has used; others must be deactivated. */
  @Delete(':id')
  remove(@Param('id', uuid) id: string, @CurrentUser() u: AuthUser) {
    return this.coupons.remove(id, u.id);
  }
}
