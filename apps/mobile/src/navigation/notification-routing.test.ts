import { describe, expect, it } from 'vitest';
import { notificationDestination, notificationLink } from './notification-routing';

describe('notification deep links', () => {
  it('routes application details and their documents, payments, and messages tabs', () => {
    expect(notificationDestination('/dashboard/applications/app-1')).toEqual({ screen: 'ApplicationDetail', params: { applicationId: 'app-1' } });
    expect(notificationDestination('https://biznexa.test/dashboard/applications/app-2/documents')).toEqual({ screen: 'ApplicationDetail', params: { applicationId: 'app-2', initialTab: 'documents' } });
    expect(notificationDestination('/applications/app-3/payments')).toEqual({ screen: 'ApplicationDetail', params: { applicationId: 'app-3', initialTab: 'payments' } });
    expect(notificationDestination('/dashboard/applications/app-4/messages')).toEqual({ screen: 'ApplicationDetail', params: { applicationId: 'app-4', initialTab: 'messages' } });
    expect(notificationDestination('/dashboard/applications/app-5', 'message.received')).toEqual({ screen: 'ApplicationDetail', params: { applicationId: 'app-5', initialTab: 'messages' } });
    expect(notificationDestination('/dashboard/applications/app-6', 'document.requested')).toEqual({ screen: 'ApplicationDetail', params: { applicationId: 'app-6', initialTab: 'documents' } });
  });

  it('routes general documents, payments, and certificates links', () => {
    expect(notificationDestination('/dashboard/documents')).toEqual({ screen: 'Documents', params: undefined });
    expect(notificationDestination('/dashboard/payments')).toEqual({ screen: 'Payments', params: undefined });
    expect(notificationDestination('/dashboard/certificates')).toEqual({ screen: 'Certificates', params: undefined });
    expect(notificationDestination('/dashboard', 'payment.succeeded')).toEqual({ screen: 'Payments', params: undefined });
    expect(notificationDestination('/dashboard', 'certificate.issued')).toEqual({ screen: 'Certificates', params: undefined });
  });

  it('routes support ticket and consultation notifications to their native sections', () => {
    expect(notificationDestination('/dashboard/support/tickets/tkt-1', 'ticket.replied')).toEqual({ screen: 'Support', params: { ticketId: 'tkt-1' } });
    expect(notificationDestination('/dashboard/consultations/bkg-1', 'consultation.reminder')).toEqual({ screen: 'Consultations', params: { bookingId: 'bkg-1' } });
  });

  it('returns Home for missing or unrecognized links and reads all supported payload keys', () => {
    expect(notificationDestination(undefined)).toEqual({ screen: 'MainTabs', params: undefined });
    expect(notificationDestination('/dashboard/unbuilt')).toEqual({ screen: 'MainTabs', params: undefined });
    expect(notificationLink({ url: '/dashboard/payments' })).toBe('/dashboard/payments');
    expect(notificationLink({ click_action: '/dashboard/certificates' })).toBe('/dashboard/certificates');
  });
});
