import { NotFoundException } from '@nestjs/common';
import { PERMS } from '@biznexa/types';
import type { AuthUser } from '../common/auth.decorators';
import type { Prisma } from '../generated/prisma/client';

/**
 * Which applications a staff user may see (M4.2): all with `applications.view_all`, only those assigned to them
 * with `applications.view_assigned`, none otherwise. `admin.access` alone grants nothing (every staff role has it).
 * Use it in every staff query on applications and their documents, notes and messages.
 */
export function applicationScope(user: AuthUser): Prisma.ApplicationWhereInput {
  if (user.permissions.includes(PERMS.APPLICATIONS_VIEW_ALL)) return {};
  if (user.permissions.includes(PERMS.APPLICATIONS_VIEW_ASSIGNED)) return { assignedToId: user.id };
  return { id: { in: [] } };
}

/** Loads one application the user may see, or 404 — an application they may not see looks like one that does not exist. */
export async function findVisibleApplication<S extends Prisma.ApplicationSelect>(
  db: Prisma.TransactionClient,
  user: AuthUser,
  id: string,
  select: S,
): Promise<Prisma.ApplicationGetPayload<{ select: S }>> {
  const app = await db.application.findFirst({ where: { AND: [{ id }, applicationScope(user)] }, select });
  if (!app) throw new NotFoundException('Application not found');
  return app;
}
