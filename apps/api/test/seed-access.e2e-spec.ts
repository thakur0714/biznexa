/**
 * Roles & permissions seed (M2.5.11) against a real database: re-running the seed adds new permissions to
 * the roles that should get them, and never undoes a grant an admin removed. Uses run-scoped keys, so the
 * real roles are untouched.
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { RoleDefinition, seedAccess } from '../prisma/seed-access';

const prisma = new PrismaService();
const run = `e2e-seed-${Date.now().toString().slice(-7)}`;
const p = (name: string) => `${run}.${name}`;
const MANAGER = `${run}-MANAGER`;
const VIEWER = `${run}-VIEWER`;

const permissions: Record<string, string> = { [p('view')]: 'View', [p('edit')]: 'Edit' };
const roles: RoleDefinition[] = [
  { key: MANAGER, name: 'Manager', description: 'All', perms: 'ALL' },
  { key: VIEWER, name: 'Viewer', description: 'Read only', perms: [p('view')] },
];

async function grants(roleKey: string) {
  const rows = await prisma.rolePermission.findMany({ where: { role: { key: roleKey } }, select: { permission: { select: { key: true } } } });
  return rows.map((r) => r.permission.key).toSorted((a, b) => a.localeCompare(b));
}

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  await seedAccess(prisma);
});

afterAll(async () => {
  await prisma.role.deleteMany({ where: { key: { startsWith: run } } });
  await prisma.permission.deleteMany({ where: { key: { startsWith: run } } });
  await prisma.$disconnect();
});

describe('seedAccess', () => {
  it('grants users.manage only to ADMIN when the production seed is applied', async () => {
    const permission = await prisma.permission.findUnique({ where: { key: 'users.manage' }, select: { id: true } });
    expect(permission).toBeTruthy();
    const assigned = await prisma.rolePermission.findMany({ where: { permissionId: permission!.id }, select: { role: { select: { key: true } } } });
    expect(assigned.map((grant) => grant.role.key)).toEqual(['ADMIN']);
  });

  it('creates missing roles with their default permissions', async () => {
    await seedAccess(prisma, permissions, roles);
    expect(await grants(MANAGER)).toEqual([p('edit'), p('view')]);
    expect(await grants(VIEWER)).toEqual([p('view')]);
  });

  it('keeps a permission an admin removed from a role, and a renamed role, when re-run', async () => {
    await prisma.rolePermission.deleteMany({ where: { role: { key: VIEWER }, permission: { key: p('view') } } });
    await prisma.role.update({ where: { key: MANAGER }, data: { name: 'Renamed by admin' } });

    const res = await seedAccess(prisma, permissions, roles);

    expect(res).toEqual({ added: [], granted: 0 });
    expect(await grants(VIEWER)).toEqual([]);
    expect((await prisma.role.findUniqueOrThrow({ where: { key: MANAGER } })).name).toBe('Renamed by admin');
  });

  it('grants a newly introduced permission only to the roles that should have it', async () => {
    const withExport = { ...permissions, [p('export')]: 'Export' };
    const res = await seedAccess(prisma, withExport, [roles[0], { ...roles[1], perms: [p('view'), p('export')] }]);

    expect(res).toEqual({ added: [p('export')], granted: 2 });
    expect(await grants(MANAGER)).toEqual([p('edit'), p('export'), p('view')]);
    expect(await grants(VIEWER)).toEqual([p('export')]); // the removed `view` grant stays removed
  });

  it('keeps grants an admin added, and a grant of a new permission an admin removed, on the next run', async () => {
    await prisma.rolePermission.create({
      data: { role: { connect: { key: VIEWER } }, permission: { connect: { key: p('edit') } } },
    });
    await prisma.rolePermission.deleteMany({ where: { role: { key: MANAGER }, permission: { key: p('export') } } });

    await seedAccess(prisma, { ...permissions, [p('export')]: 'Export' }, roles);

    expect(await grants(VIEWER)).toEqual([p('edit'), p('export')]);
    expect(await grants(MANAGER)).toEqual([p('edit'), p('view')]);
  });
});
