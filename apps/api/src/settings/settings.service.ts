import { isDeepStrictEqual } from 'node:util';
import { Injectable } from '@nestjs/common';
import { SELLER_SETTING_KEYS, REJECTION_PRESETS_KEY, MOBILE_VERSION_KEY, readSellerSettings, sellerSettingValues, type SellerSettings, type SellerSettingsData, type RejectionPresets, type RejectionPresetsInput, type MobileVersion, type MobileVersionInput } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../generated/prisma/client';

const KEYS: string[] = Object.values(SELLER_SETTING_KEYS);

/**
 * Seller details (M3.14, D41): one `Setting` row per field, written together. The order summary reads
 * `company.state` (M3.13) and invoices copy the rest (M3.21).
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** @param db a transaction, so an invoice copies the details it is issued with (M3.21). */
  async seller(db: Prisma.TransactionClient = this.prisma): Promise<SellerSettings> {
    const rows = await db.setting.findMany({ where: { key: { in: KEYS } }, select: { key: true, value: true, updatedAt: true } });
    const updatedAt = rows.reduce<Date | null>((at, r) => (!at || r.updatedAt > at ? r.updatedAt : at), null);
    return readSellerSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])), updatedAt);
  }

  /** Saves every field in one transaction; the audit entry holds only the keys that changed. */
  async updateSeller(data: SellerSettingsData, actorId: string): Promise<SellerSettings> {
    // As stored: no `undefined` (an address without line2). jsonb also reorders keys, hence a deep compare.
    const values = JSON.parse(JSON.stringify(sellerSettingValues(data))) as Record<string, unknown>; // NOSONAR: a JSON round trip drops undefined
    const before = await this.prisma.setting.findMany({ where: { key: { in: KEYS } }, select: { key: true, value: true } });
    const old = new Map(before.map((r) => [r.key, r.value]));
    const changed = Object.keys(values).filter((k) => !isDeepStrictEqual(old.get(k) ?? null, values[k]));
    if (!changed.length) return this.seller();

    await this.prisma.$transaction(
      changed.map((key) => {
        const value = values[key] as object;
        return this.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
      }),
    );
    await this.audit.log({
      actorId,
      action: 'settings.seller.update',
      entityType: 'Setting',
      entityId: 'seller',
      before: Object.fromEntries(changed.map((k) => [k, old.get(k) ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, values[k]])),
    });
    return this.seller();
  }

  async rejectionPresets(db: Prisma.TransactionClient = this.prisma): Promise<RejectionPresets> {
    const row = await db.setting.findUnique({ where: { key: REJECTION_PRESETS_KEY }, select: { value: true, updatedAt: true } });
    let presets: string[] = [];
    if (row && Array.isArray(row.value)) {
      presets = row.value as string[];
    }
    return { presets, updatedAt: row?.updatedAt?.toISOString() ?? null };
  }

  async updateRejectionPresets(presets: RejectionPresetsInput, actorId: string): Promise<RejectionPresets> {
    const beforeRow = await this.prisma.setting.findUnique({ where: { key: REJECTION_PRESETS_KEY }, select: { value: true } });
    const oldPresets = Array.isArray(beforeRow?.value) ? beforeRow?.value : [];
    
    if (isDeepStrictEqual(oldPresets, presets)) {
      return this.rejectionPresets();
    }
    
    const value = presets as object;
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: REJECTION_PRESETS_KEY },
        update: { value },
        create: { key: REJECTION_PRESETS_KEY, value },
      });
      await this.audit.log({
        actorId,
        action: 'settings.rejection-presets.update',
        entityType: 'Setting',
        entityId: REJECTION_PRESETS_KEY,
        before: { presets: oldPresets },
        after: { presets },
      }, tx);
    });
    
    return this.rejectionPresets();
  }

  async mobileVersion(db: Prisma.TransactionClient = this.prisma): Promise<MobileVersion> {
    const row = await db.setting.findUnique({ where: { key: MOBILE_VERSION_KEY }, select: { value: true, updatedAt: true } });
    let minSupportedVersion = '1.0.0';
    if (row && typeof row.value === 'string') {
      minSupportedVersion = row.value;
    }
    return { minSupportedVersion, updatedAt: row?.updatedAt?.toISOString() ?? null };
  }

  async updateMobileVersion(data: MobileVersionInput, actorId: string): Promise<MobileVersion> {
    const beforeRow = await this.prisma.setting.findUnique({ where: { key: MOBILE_VERSION_KEY }, select: { value: true } });
    const oldVersion = typeof beforeRow?.value === 'string' ? beforeRow.value : '1.0.0';

    if (oldVersion === data.minSupportedVersion) {
      return this.mobileVersion();
    }

    const value = data.minSupportedVersion;
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({
        where: { key: MOBILE_VERSION_KEY },
        update: { value },
        create: { key: MOBILE_VERSION_KEY, value },
      });
      await this.audit.log({
        actorId,
        action: 'settings.mobile-version.update',
        entityType: 'Setting',
        entityId: MOBILE_VERSION_KEY,
        before: { minSupportedVersion: oldVersion },
        after: { minSupportedVersion: data.minSupportedVersion },
      }, tx);
    });

    return this.mobileVersion();
  }
}
