import type { BookingView } from '@biznexa/types';

/** UI eligibility only; the server checks BOOKING_CHANGE_WINDOW_HOURS for every change. */
export function canChangeBooking(booking: Pick<BookingView, 'status'>): boolean {
  return booking.status === 'CONFIRMED';
}

export function getJoinLink(booking: Pick<BookingView, 'status' | 'meetingLink'>): string | null {
  return booking.status === 'CONFIRMED' ? booking.meetingLink : null;
}
