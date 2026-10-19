import type { RootStackParamList } from './RootNavigator';

export type NotificationDestination =
  | { screen: 'MainTabs'; params: undefined }
  | { screen: 'ApplicationDetail'; params: RootStackParamList['ApplicationDetail'] }
  | { screen: 'Documents'; params: undefined }
  | { screen: 'Payments'; params: undefined }
  | { screen: 'Certificates'; params: undefined };

const home: NotificationDestination = { screen: 'MainTabs', params: undefined };

/** Convert the existing notification `data.link` into a native screen destination. */
export function notificationDestination(link: unknown, event?: unknown): NotificationDestination {
  const eventName = typeof event === 'string' ? event : '';
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
