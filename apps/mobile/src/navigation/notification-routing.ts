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

function ticketDestination(link: unknown): NotificationDestination {
  const match = typeof link === 'string' ? /(?:tickets\/|tickets\/thread\/)([^/?#]+)/.exec(link) : null;
  return { screen: 'Support', params: match ? { ticketId: decodeURIComponent(match[1]) } : undefined };
}

function consultationDestination(link: unknown): NotificationDestination {
  const match = typeof link === 'string' ? /consultations\/([^/?#]+)/.exec(link) : null;
  return { screen: 'Consultations', params: match ? { bookingId: decodeURIComponent(match[1]) } : undefined };
}

function applicationMatch(path: string): RegExpExecArray | null {
  return /^\/dashboard\/applications\/([^/]+)(?:\/(documents|payments|messages))?\/?$/.exec(path)
    ?? /^\/applications\/([^/]+)(?:\/(documents|payments|messages))?\/?$/.exec(path);
}

function applyDestination(match: RegExpExecArray): NotificationDestination {
  let serviceSlug: string;
  let applicationId: string;
  try { serviceSlug = decodeURIComponent(match[1]); applicationId = decodeURIComponent(match[2]); } catch { return home; }
  let stage: 'form' | 'documents' | 'payment' = 'form';
  if (match[3] === 'documents') stage = 'documents';
  else if (match[3] === 'payment') stage = 'payment';
  return { screen: 'BuyFlow', params: { slug: serviceSlug, applicationId, initialStep: stage } };
}

function applicationDestination(match: RegExpExecArray, tabHint?: 'documents' | 'messages'): NotificationDestination {
  let applicationId: string;
  try { applicationId = decodeURIComponent(match[1]); } catch { return home; }
  const tabName = match[2];
  const pathTab = tabName === 'documents' || tabName === 'payments' || tabName === 'messages' ? tabName : undefined;
  const initialTab = tabHint ?? pathTab;
  return { screen: 'ApplicationDetail', params: { applicationId, ...(initialTab ? { initialTab } : {}) } };
}

/** Convert the existing notification `data.link` into a native screen destination. */
export function notificationDestination(link: unknown, event?: unknown): NotificationDestination {
  const eventName = typeof event === 'string' ? event : '';
  if (eventName.startsWith('ticket.')) return ticketDestination(link);
  if (eventName.startsWith('consultation.')) return consultationDestination(link);
  let tabHint: 'documents' | 'messages' | undefined;
  if (eventName.startsWith('document.')) tabHint = 'documents';
  else if (eventName.startsWith('message.')) tabHint = 'messages';
  if (eventName.startsWith('certificate.')) return { screen: 'Certificates', params: undefined };
  if (eventName.startsWith('payment.') || eventName === 'invoice.issued' || eventName.startsWith('refund.')) return { screen: 'Payments', params: undefined };
  if (typeof link !== 'string' || !link.trim()) return home;
  let path: string;
  try {
    path = new URL(link, 'https://biznexa.invalid').pathname;
  } catch {
    return home;
  }
  const application = applicationMatch(path);
  const apply = /^\/apply\/([^/]+)\/([^/]+)(?:\/(documents|payment))?\/?$/.exec(path);
  if (apply) return applyDestination(apply);
  if (application) return applicationDestination(application, tabHint);
  if (tabHint === 'documents' || /^\/dashboard\/(?:documents|applications\/[^/]+\/documents)\/?$/.test(path)) return { screen: 'Documents', params: undefined };
  if (/^\/dashboard\/(?:payments|orders)\/?$/.test(path)) return { screen: 'Payments', params: undefined };
  if (/^\/dashboard\/certificates\/?$/.test(path)) return { screen: 'Certificates', params: undefined };
  return home;
}

export function notificationLink(data: Record<string, unknown>): unknown {
  return data.link ?? data.url ?? data.click_action;
}
