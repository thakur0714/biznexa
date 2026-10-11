/**
 * Permission keys. Roles are bundles of these (rows in the database, see apps/api/prisma/seed.ts),
 * so new roles need no code change. The API checks them with @RequirePermissions(); the admin app
 * uses them only to decide what to show.
 */
export const PERMS = {
  /** May sign in to the admin / operations portal at all. Every staff role has it; customers do not. */
  ADMIN_ACCESS: 'admin.access',
  SERVICES_MANAGE: 'services.manage',
  APPLICATIONS_VIEW_ALL: 'applications.view_all',
  APPLICATIONS_VIEW_ASSIGNED: 'applications.view_assigned',
  APPLICATIONS_UPDATE: 'applications.update',
  DOCUMENTS_REVIEW: 'documents.review',
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_MANAGE: 'customers.manage',
  PAYMENTS_VIEW: 'payments.view',
  PAYMENTS_REFUND: 'payments.refund',
  COUPONS_MANAGE: 'coupons.manage',
  CONSULTANTS_MANAGE: 'consultants.manage',
  CERTIFICATES_MANAGE: 'certificates.manage',
  CMS_MANAGE: 'cms.manage',
  TICKETS_MANAGE: 'tickets.manage',
  REPORTS_VIEW: 'reports.view',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
  LEADS_VIEW: 'leads.view',
} as const;

export type Permission = (typeof PERMS)[keyof typeof PERMS];

/**
 * True when `held` satisfies the requirement.
 * `all` — every listed permission is needed; `any` — one of them is enough. An empty requirement passes.
 */
export function hasPermissions(held: readonly string[], required: { all?: readonly string[]; any?: readonly string[] }): boolean {
  if (required.all && !required.all.every((p) => held.includes(p))) return false;
  if (required.any?.length && !required.any.some((p) => held.includes(p))) return false;
  return true;
}

/** May this user use the admin portal? */
export const canUseAdmin = (held: readonly string[]) => held.includes(PERMS.ADMIN_ACCESS);
