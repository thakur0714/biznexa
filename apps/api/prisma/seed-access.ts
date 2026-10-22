/**
 * Roles & permissions seed (M2.5.11). Additive only, so roles edited in the admin UI survive `pnpm db:seed`:
 * - a permission or role that does not exist yet is created; a new role gets its default permissions;
 * - a permission that is new in this run is granted to every existing role that should have it by default;
 * - existing grants and role names are never changed or removed. Permission descriptions are code-owned
 *   and kept in sync.
 */
import type { PrismaClient } from '../src/generated/prisma/client';

export type RoleDefinition = { key: string; name: string; description: string; perms: string[] | 'ALL' };

export const PERMISSIONS: Record<string, string> = {
  'admin.access': 'Sign in to the admin / operations portal',
  'services.manage': 'Create and edit services, packages, documents, stages and FAQs',
  'applications.view_all': 'See every application',
  'applications.view_assigned': 'See applications assigned to me',
  'applications.update': 'Update application status, notes and deliverables',
  'documents.review': 'Approve or reject customer documents',
  'customers.view': 'View customer profiles',
  'customers.manage': 'Block or deactivate customers',
  'payments.view': 'View payments and invoices',
  'payments.refund': 'Issue refunds',
  'coupons.manage': 'Create and edit coupons',
  'consultants.manage': 'Approve and manage consultants',
  'certificates.manage': 'Issue and manage certificates',
  'cms.manage': 'Edit website content and blog',
  'tickets.manage': 'Handle support tickets',
  'reports.view': 'View reports',
  'settings.manage': 'Change platform settings, roles and staff',
  'users.manage': 'Manage staff accounts, roles, status and two-factor setup',
  'audit.view': 'View the audit log',
  'leads.view': 'View enquiries from the website',
  'notifications.view': 'View the notification delivery log and retry failed deliveries',
  'privacy.manage': 'Handle data export and account deletion requests',
};

export const ROLES: RoleDefinition[] = [
  { key: 'ADMIN', name: 'Admin', description: 'Full platform management', perms: 'ALL' },
  { key: 'OPERATIONS', name: 'Operations Executive', description: 'Processes customer applications', perms: ['admin.access', 'applications.view_assigned', 'applications.update', 'documents.review', 'customers.view'] },
  { key: 'CONSULTANT', name: 'Consultant', description: 'Handles assigned services and consultations', perms: ['admin.access', 'applications.view_assigned'] },
  { key: 'SUPPORT', name: 'Support Executive', description: 'Handles customer support', perms: ['admin.access', 'customers.view', 'payments.view', 'tickets.manage', 'leads.view'] },
  { key: 'CUSTOMER', name: 'Customer', description: 'Purchases and tracks services', perms: [] },
];

export async function seedAccess(prisma: PrismaClient, permissions = PERMISSIONS, roles = ROLES) {
  const keys = Object.keys(permissions);
  // One transaction, so a crash between creating a permission and granting it cannot leave it ungranted forever.
  return prisma.$transaction(
    async (tx) => {
      const existing = new Set((await tx.permission.findMany({ where: { key: { in: keys } }, select: { key: true } })).map((p) => p.key));
      const ids: Record<string, string> = {};
      for (const [key, description] of Object.entries(permissions)) {
        ids[key] = (await tx.permission.upsert({ where: { key }, update: { description }, create: { key, description } })).id; // NOSONAR: seed writes run in order
      }
      const added = keys.filter((k) => !existing.has(k));

      let granted = 0;
      for (const r of roles) {
        const defaults = r.perms === 'ALL' ? keys : r.perms;
        let role = await tx.role.findUnique({ where: { key: r.key } }); // NOSONAR: seed writes run in order
        const grant = role ? defaults.filter((k) => added.includes(k)) : defaults;
        role ??= await tx.role.create({ data: { key: r.key, name: r.name, description: r.description, isSystem: true } }); // NOSONAR: seed writes run in order
        if (grant.length) {
          const res = await tx.rolePermission.createMany({ data: grant.map((k) => ({ roleId: role.id, permissionId: ids[k] })), skipDuplicates: true }); // NOSONAR: seed writes run in order
          granted += res.count;
        }
      }
      console.log(`✓ ${roles.length} roles, ${keys.length} permissions (${added.length} new, ${granted} grants added)`);
      return { added, granted };
    },
    { timeout: 30_000 },
  );
}
