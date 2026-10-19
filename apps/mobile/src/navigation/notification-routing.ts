import type { RootStackParamList } from './RootNavigator';

export type NotificationDestination =
  | { screen: 'MainTabs'; params: undefined }
  | { screen: 'ApplicationDetail'; params: RootStackParamList['ApplicationDetail'] }
  | { screen: 'BuyFlow'; params: RootStackParamList['BuyFlow'] }
  | { screen: 'Documents'; params: undefined }
  | { screen: 'Payments'; params: undefined }
  | { screen: 'Certificates'; params: undefined }
  | { screen: 'Support'; params: { ticketId?: string } | undefined }
  | { screen: 'Consultations'; params: { bookingId?: string } | undefined };

const home: NotificationDestination = { screen: 'MainTabs', params: undefined };

/** Convert the existing notification `data.link` into a native screen destination. */
export function notificationDestination(link: unknown, event?: unknown): NotificationDestination {
  const eventName = typeof event === 'string' ? event : '';
  if (eventName.startsWith('ticket.')) {
    const ticket = typeof link === 'string' ? link.match(/(?:tickets\/|tickets\/thread\/)([^/?#]+)/) : null;
    return { screen: 'Support', params: ticket ? { ticketId: decodeURIComponent(ticket[1]) } : undefined };
  }
  if (eventName.startsWith('consultation.')) {
    const booking = typeof link === 'string' ? link.match(/consultations\/([^/?#]+)/) : null;
    return { screen: 'Consultations', params: booking ? { bookingId: decodeURIComponent(booking[1]) } : undefined };
  }
  const tabHint = eventName.startsWith('document.') ? 'documents' : eventName.startsWith('message.') ? 'messages' : undefined;
  if (eventName.startsWith('certificate.')) return { screen: 'Certificates', params: undefined };
  if (eventName.startsWith('payment.') || eventName === 'invoice.issued' || eventName.startsWith('refund.')) return { screen: 'Payments', params: undefined };
  if (typeof link !== 'string' || !link.trim()) return home;
  let path: string;
  try {
    path = new URL(link, 'https://biznexa.invalid').pathname;
  } catch {
    return home;
  }
  const application = path.match(/^\/dashboard\/applications\/([^/]+)(?:\/(documents|payments|messages))?\/?$/)
    ?? path.match(/^\/applications\/([^/]+)(?:\/(documents|payments|messages))?\/?$/);
  const apply = path.match(/^\/apply\/([^/]+)\/([^/]+)(?:\/(documents|payment))?\/?$/);
  if (apply) {
    let serviceSlug: string;
    let applicationId: string;
    try { serviceSlug = decodeURIComponent(apply[1]); applicationId = decodeURIComponent(apply[2]); } catch { return home; }
    const stage = apply[3] === 'documents' ? 'documents' : apply[3] === 'payment' ? 'payment' : 'form';
    return { screen: 'BuyFlow', params: { slug: serviceSlug, applicationId, initialStep: stage } };
  }
  if (application) {
    let applicationId: string;
    try { applicationId = decodeURIComponent(application[1]); } catch { return home; }
    const tabName = application[2];
    const initialTab = tabHint ?? (tabName === 'documents' || tabName === 'payments' || tabName === 'messages' ? tabName : undefined);
    return { screen: 'ApplicationDetail', params: { applicationId, ...(initialTab ? { initialTab } : {}) } };
  }
  if (tabHint === 'documents' || /^\/dashboard\/(?:documents|applications\/[^/]+\/documents)\/?$/.test(path)) return { screen: 'Documents', params: undefined };
  if (/^\/dashboard\/(?:payments|orders)\/?$/.test(path)) return { screen: 'Payments', params: undefined };
  if (/^\/dashboard\/certificates\/?$/.test(path)) return { screen: 'Certificates', params: undefined };
  return home;
}

export function notificationLink(data: Record<string, unknown>): unknown {
  return data.link ?? data.url ?? data.click_action;
}
