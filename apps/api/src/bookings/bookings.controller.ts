import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  bookingCheckoutSchema,
  bookingListSchema,
  bookingMeetingLinkSchema,
  bookingCancelInputSchema,
  bookingRescheduleInputSchema,
  bookingConsultantOutcomeSchema,
  bookingViewSchema,
  createBookingInputSchema,
  paymentCallbackInput,
  type CreateBookingInput,
  type BookingMeetingLinkInput,
  type BookingConsultantOutcomeInput,
  type PaymentCallbackInput,
} from '@biznexa/types';
import { AuthUser, CurrentUser, PERMS, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { BookingPaymentsService } from '../payments/booking-payments.service';
import { BookingsService } from './bookings.service';

/** The signed-in customer's consultation bookings (M8.8). Another customer's booking looks missing (404). */
@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService, private readonly payments: BookingPaymentsService) {}

  /** Holds the slot for 10 minutes as a PENDING_PAYMENT booking. Picking another slot releases your previous hold. */
  @ApiZodResponse('BookingView', bookingViewSchema, 201)
  @ApiResponse({ status: 400, description: 'Bad body, a type the consultant doesn’t offer, or booking yourself' })
  @ApiResponse({ status: 404, description: 'No approved consultant with this slug' })
  @ApiResponse({ status: 409, description: 'The slot is not offered or already held / booked' })
  @Post()
  create(@ZodBody(createBookingInputSchema) body: CreateBookingInput, @CurrentUser() u: AuthUser) {
    return this.bookings.create(u.id, body);
  }

  @ApiZodResponse('BookingList', bookingListSchema)
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.bookings.list(u.id);
  }

  /** The booking page polls this after checkout: `status` turns CONFIRMED only once the gateway's webhook has paid it. */
  @ApiZodResponse('BookingView', bookingViewSchema)
  @ApiResponse({ status: 404, description: 'No such booking among yours' })
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() u: AuthUser) {
    return this.bookings.get(u.id, id);
  }

  @Get(':id/calendar.ics')
  async calendar(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() u: AuthUser, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="booking-${id}.ics"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(await this.bookings.calendar(u.id, id));
  }

  @RequirePermissions(PERMS.ADMIN_ACCESS)
  @ApiZodResponse('BookingView', bookingViewSchema)
  @Put(':id/meeting-link')
  setMeetingLink(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(bookingMeetingLinkSchema) body: BookingMeetingLinkInput, @CurrentUser() u: AuthUser) {
    return this.bookings.setMeetingLink(u.id, id, body.meetingLink);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(bookingCancelInputSchema) body: { reason?: string }, @CurrentUser() u: AuthUser) {
    return this.bookings.cancel(u.id, id, body.reason);
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  reschedule(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(bookingRescheduleInputSchema) body: { startAt: string }, @CurrentUser() u: AuthUser) {
    return this.bookings.reschedule(u.id, id, new Date(body.startAt));
  }

  @RequirePermissions(PERMS.ADMIN_ACCESS)
  @Post(':id/outcome')
  @HttpCode(200)
  outcome(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(bookingConsultantOutcomeSchema) body: BookingConsultantOutcomeInput, @CurrentUser() u: AuthUser) {
    return this.bookings.consultantOutcome(u.id, id, body.status);
  }

  /** Creates (or reuses) the payment and gateway order for the booking's fee while the hold lasts. */
  @ApiZodResponse('BookingCheckout', bookingCheckoutSchema)
  @ApiResponse({ status: 404, description: 'No such booking among yours' })
  @ApiResponse({ status: 409, description: 'Already paid, or the hold ran out (pick a slot again)' })
  @ApiResponse({ status: 502, description: 'The payment gateway refused the order; try again' })
  @ApiResponse({ status: 503, description: 'The payment gateway could not be reached; try again' })
  @Post(':id/payment')
  @HttpCode(200)
  pay(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() u: AuthUser) {
    return this.payments.start(u.id, id);
  }

  /** Checkout's success callback: a valid signature shows the payment as confirming; only the webhook confirms the booking. */
  @ApiZodResponse('BookingView', bookingViewSchema)
  @ApiResponse({ status: 400, description: 'Bad body, or the signature or ids don’t match a payment of this booking' })
  @ApiResponse({ status: 404, description: 'No such booking among yours' })
  @Post(':id/payment/callback')
  @HttpCode(200)
  callback(@Param('id', new ParseUUIDPipe()) id: string, @ZodBody(paymentCallbackInput) body: PaymentCallbackInput, @CurrentUser() u: AuthUser) {
    return this.payments.callback(u.id, id, body);
  }
}
