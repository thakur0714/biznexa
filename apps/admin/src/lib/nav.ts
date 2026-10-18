import { PERMS, hasPermissions } from '@biznexa/types';

export interface NavItem {
  /** URL segment: the item lives at `/${slug}` ('' is the dashboard). */
  slug: string;
  label: string;
  /** Hold every permission in `all` and at least one in `any`. */
  requires: { all?: string[]; any?: string[] };
  /** Has its own route under app/(portal)/<slug>; the others show the "Coming soon" placeholder. */
  built?: true;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Portal sections (PROMPT §7.7). The sidebar shows only what the signed-in user's permissions allow;
 * the API checks the same permissions on every route behind each page.
 */
export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ slug: '', label: 'Dashboard', requires: { all: [PERMS.ADMIN_ACCESS] } }],
  },
  {
    label: 'Work',
    items: [
      { slug: 'applications', label: 'Applications', requires: { any: [PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED] }, built: true },
      { slug: 'documents', label: 'Document review', requires: { all: [PERMS.DOCUMENTS_REVIEW] }, built: true },
      { slug: 'customers', label: 'Customers', requires: { all: [PERMS.CUSTOMERS_VIEW] }, built: true },
      { slug: 'support', label: 'Support tickets', requires: { all: [PERMS.TICKETS_MANAGE] }, built: true },
      { slug: 'leads', label: 'Enquiries', requires: { all: [PERMS.LEADS_VIEW] } },
    ],
  },
  {
    label: 'Catalogue & sales',
    items: [
      { slug: 'services', label: 'Services', requires: { all: [PERMS.SERVICES_MANAGE] }, built: true },
      { slug: 'payments', label: 'Payments', requires: { all: [PERMS.PAYMENTS_VIEW] }, built: true },
      { slug: 'coupons', label: 'Coupons', requires: { all: [PERMS.COUPONS_MANAGE] }, built: true },
      { slug: 'consultants', label: 'Consultants', requires: { all: [PERMS.CONSULTANTS_MANAGE] }, built: true },
      { slug: 'reviews', label: 'Review moderation', requires: { all: [PERMS.CONSULTANTS_MANAGE] }, built: true },
      { slug: 'certificates', label: 'Certificates', requires: { all: [PERMS.CERTIFICATES_MANAGE] }, built: true },
    ],
  },
  {
    label: 'Website',
    items: [{ slug: 'cms', label: 'Content & blog', requires: { all: [PERMS.CMS_MANAGE] } }],
  },
  {
    label: 'Administration',
    items: [
      { slug: 'reports', label: 'Reports', requires: { all: [PERMS.REPORTS_VIEW] }, built: true },
      { slug: 'notifications', label: 'Notification log', requires: { all: [PERMS.NOTIFICATIONS_VIEW] }, built: true },
      { slug: 'privacy', label: 'Privacy requests', requires: { all: [PERMS.PRIVACY_MANAGE] }, built: true },
      { slug: 'audit', label: 'Audit log', requires: { all: [PERMS.AUDIT_VIEW] }, built: true },
      { slug: 'settings', label: 'Settings', requires: { all: [PERMS.SETTINGS_MANAGE] }, built: true },
    ],
  },
];

const CONSULTANT_PORTAL_NAV: NavGroup[] = [{
  label: 'Consultant portal',
  items: [
    { slug: 'consultant/profile', label: 'My profile', requires: { all: [PERMS.ADMIN_ACCESS] }, built: true },
    { slug: 'consultant/availability', label: 'Availability', requires: { all: [PERMS.ADMIN_ACCESS] }, built: true },
  ],
}];

export const canSee = (item: NavItem, perms: readonly string[]) => hasPermissions(perms, item.requires);

/** Groups and items the user may see; empty groups are dropped. */
export function visibleNav(perms: readonly string[], nav: NavGroup[] = NAV, roles: readonly string[] = []): NavGroup[] {
  if (roles.includes('CONSULTANT')) return CONSULTANT_PORTAL_NAV.map((g) => ({ ...g, items: g.items.filter((i) => canSee(i, perms)) })).filter((g) => g.items.length > 0);
  return nav.map((g) => ({ ...g, items: g.items.filter((i) => canSee(i, perms)) })).filter((g) => g.items.length > 0);
}

export function findNavItem(slug: string, nav: NavGroup[] = NAV): NavItem | undefined {
  for (const g of nav) for (const i of g.items) if (i.slug === slug) return i;
  return undefined;
}
