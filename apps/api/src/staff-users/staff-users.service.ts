import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';
import type { AdminStaffListQuery, AdminStaffRow, AdminStaffStatusInput, CreateAdminStaffInput, UpdateAdminStaffRolesInput } from '@biznexa/types';

const staffFilter: Prisma.UserWhereInput = { roles: { some: { role: { key: { not: 'CUSTOMER' } } } } };

@Injectable()
export class StaffUsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly tokens: TokenService) {}

  private async roleKeys(db: Prisma.TransactionClient | PrismaService, userId: string) {
    const rows = await db.userRole.findMany({ where: { userId }, include: { role: { select: { key: true } } } });
    return rows.map((row) => row.role.key).sort();
  }

  private async rolesForInput(keys: string[], db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const unique = [...new Set(keys)];
    if (unique.length !== keys.length || unique.includes('CUSTOMER')) throw new ConflictException('Choose each staff role once; CUSTOMER cannot be assigned here');
    const rows = await db.role.findMany({
      where: { key: { in: unique }, permissions: { some: { permission: { key: 'admin.access' } } } },
      select: { id: true, key: true, name: true },
    });
    if (rows.length !== unique.length) throw new ConflictException('Choose valid staff roles');
    return rows;
  }

  async roleOptions() {
    const roles = await this.prisma.role.findMany({
      where: { key: { not: 'CUSTOMER' }, permissions: { some: { permission: { key: 'admin.access' } } } },
      orderBy: { name: 'asc' }, select: { key: true, name: true },
    });
    return roles;
  }

  async list(params: AdminStaffListQuery) {
    const where: Prisma.UserWhereInput = { ...staffFilter };
    if (params.q) {
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { email: { contains: params.q, mode: 'insensitive' } },
        { mobile: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (params.page - 1) * params.limit, take: params.limit,
        select: { id: true, name: true, email: true, mobile: true, status: true, totpEnabledAt: true, lastLoginAt: true,
          roles: { where: { role: { key: { not: 'CUSTOMER' } } }, select: { role: { select: { key: true, name: true } } }, orderBy: { role: { name: 'asc' } } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: users.map((user): AdminStaffRow => ({
        id: user.id, name: user.name, email: user.email, mobile: user.mobile,
        roles: user.roles.map(({ role }) => role), status: user.status, active: user.status === 'ACTIVE',
        twoFactorEnabled: !!user.totpEnabledAt, lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      })), total, page: params.page, limit: params.limit,
    };
  }

  async create(input: CreateAdminStaffInput, actorId: string) {
    if (await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new ConflictException('An account with this email already exists');
    const roles = await this.rolesForInput(input.roles);
    const passwordHash = await bcrypt.hash(input.temporaryPassword, 12);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: input.name, email: input.email, mobile: input.mobile, passwordHash, emailVerified: true, consentAt: new Date(), roles: { create: roles.map((role) => ({ roleId: role.id })) } },
        select: { id: true, name: true, email: true, mobile: true, status: true, totpEnabledAt: true, lastLoginAt: true },
      });
      const roleKeys = roles.map((role) => role.key).sort();
      await this.audit.log({ actorId, action: 'staff.create', entityType: 'User', entityId: created.id, before: null, after: { name: created.name, email: created.email, mobile: created.mobile, roles: roleKeys, status: created.status, twoFactorEnabled: false } }, tx);
      return created;
    });
    return { id: user.id, name: user.name, email: user.email, mobile: user.mobile, roles: roles.map(({ key, name }) => ({ key, name })), status: user.status, active: true, twoFactorEnabled: false, lastLoginAt: null } satisfies AdminStaffRow;
  }

  async updateRoles(id: string, input: UpdateAdminStaffRolesInput, actorId: string) {
    const roles = await this.rolesForInput(input.roles);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, ...staffFilter }, select: { id: true, status: true, name: true, email: true, mobile: true, totpEnabledAt: true, lastLoginAt: true } });
      if (!user) throw new NotFoundException('Staff user not found');
      const beforeRoles = await this.roleKeys(tx, id);
      const afterRoles = [...new Set([...input.roles, ...(beforeRoles.includes('CUSTOMER') ? ['CUSTOMER'] : [])])].sort();
      await this.protectLastAdmin(tx, user.status, beforeRoles, afterRoles);
      await tx.userRole.deleteMany({ where: { userId: id, role: { key: { not: 'CUSTOMER' } } } });
      await tx.userRole.createMany({ data: roles.map((role) => ({ userId: id, roleId: role.id })), skipDuplicates: true });
      await this.audit.log({ actorId, action: 'staff.roles', entityType: 'User', entityId: id, before: { roles: beforeRoles }, after: { roles: afterRoles } }, tx);
      return { id, name: user.name, email: user.email, mobile: user.mobile, roles: roles.map(({ key, name }) => ({ key, name })), status: user.status, active: user.status === 'ACTIVE', twoFactorEnabled: !!user.totpEnabledAt, lastLoginAt: user.lastLoginAt?.toISOString() ?? null } satisfies AdminStaffRow;
    }, { isolationLevel: 'Serializable' });
  }

  private async protectLastAdmin(tx: Prisma.TransactionClient, status: string, beforeRoles: string[], afterRoles: string[]) {
    if (status !== 'ACTIVE' || !beforeRoles.includes('ADMIN') || afterRoles.includes('ADMIN')) return;
    const activeAdmins = await tx.user.count({ where: { status: 'ACTIVE', roles: { some: { role: { key: 'ADMIN' } } } } });
    if (activeAdmins <= 1) throw new ConflictException('The last active ADMIN must remain active');
  }

  async setActive(id: string, input: AdminStaffStatusInput, actorId: string) {
    if (!input.active && id === actorId) throw new ForbiddenException('You cannot deactivate your own account');
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, ...staffFilter }, select: { id: true, name: true, email: true, mobile: true, status: true, totpEnabledAt: true, lastLoginAt: true } });
      if (!user) throw new NotFoundException('Staff user not found');
      const beforeRoles = await this.roleKeys(tx, id);
      const nextStatus = input.active ? 'ACTIVE' : 'DEACTIVATED';
      if (user.status === 'ACTIVE' && nextStatus !== 'ACTIVE') await this.protectLastAdmin(tx, user.status, beforeRoles, []);
      const updated = await tx.user.update({ where: { id }, data: { status: nextStatus } });
      if (!input.active) await this.tokens.revokeAll(id, tx);
      await this.audit.log({ actorId, action: 'staff.status', entityType: 'User', entityId: id, before: { status: user.status, active: user.status === 'ACTIVE' }, after: { status: updated.status, active: updated.status === 'ACTIVE' } }, tx);
      return { ...user, status: updated.status, beforeRoles };
    }, { isolationLevel: 'Serializable' });
    return { id, name: result.name, email: result.email, mobile: result.mobile, roles: (await this.prisma.role.findMany({ where: { key: { in: result.beforeRoles.filter((key) => key !== 'CUSTOMER') } }, select: { key: true, name: true }, orderBy: { name: 'asc' } })), status: result.status, active: result.status === 'ACTIVE', twoFactorEnabled: !!result.totpEnabledAt, lastLoginAt: result.lastLoginAt?.toISOString() ?? null } satisfies AdminStaffRow;
  }

  async resetTwoFactor(id: string, actorId: string) {
    if (id === actorId) throw new ForbiddenException('You cannot reset your own two-factor authentication here');
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id, ...staffFilter }, select: { id: true, totpEnabledAt: true } });
      if (!user) throw new NotFoundException('Staff user not found');
      await tx.user.update({ where: { id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpFailures: 0, totpLockedUntil: null } });
      await this.tokens.revokeAll(id, tx);
      await this.audit.log({ actorId, action: 'user.2fa_reset', entityType: 'User', entityId: id, before: { enabled: !!user.totpEnabledAt }, after: { enabled: false } }, tx);
    });
    return { success: true };
  }
}
