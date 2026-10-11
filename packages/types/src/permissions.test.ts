import { describe, expect, it } from 'vitest';
import { PERMS, canUseAdmin, hasPermissions } from './index';

describe('hasPermissions', () => {
  const held = [PERMS.CUSTOMERS_VIEW, PERMS.TICKETS_MANAGE];

  it('passes an empty requirement', () => {
    expect(hasPermissions([], {})).toBe(true);
    expect(hasPermissions([], { all: [], any: [] })).toBe(true);
  });

  it('needs every permission in `all`', () => {
    expect(hasPermissions(held, { all: [PERMS.CUSTOMERS_VIEW, PERMS.TICKETS_MANAGE] })).toBe(true);
    expect(hasPermissions(held, { all: [PERMS.CUSTOMERS_VIEW, PERMS.PAYMENTS_REFUND] })).toBe(false);
  });

  it('needs at least one permission in `any`', () => {
    expect(hasPermissions(held, { any: [PERMS.APPLICATIONS_VIEW_ALL, PERMS.TICKETS_MANAGE] })).toBe(true);
    expect(hasPermissions(held, { any: [PERMS.APPLICATIONS_VIEW_ALL, PERMS.APPLICATIONS_VIEW_ASSIGNED] })).toBe(false);
  });

  it('combines `all` and `any`', () => {
    expect(hasPermissions(held, { all: [PERMS.CUSTOMERS_VIEW], any: [PERMS.TICKETS_MANAGE] })).toBe(true);
    expect(hasPermissions(held, { all: [PERMS.CUSTOMERS_MANAGE], any: [PERMS.TICKETS_MANAGE] })).toBe(false);
  });
});

describe('canUseAdmin', () => {
  it('requires admin.access', () => {
    expect(canUseAdmin([PERMS.ADMIN_ACCESS])).toBe(true);
    expect(canUseAdmin([])).toBe(false);
    // holding other staff permissions without admin.access is not enough
    expect(canUseAdmin([PERMS.SERVICES_MANAGE])).toBe(false);
  });
});
