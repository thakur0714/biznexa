import { isDeepStrictEqual } from 'node:util';
import { Injectable } from '@nestjs/common';
import { SELLER_SETTING_KEYS, readSellerSettings, sellerSettingValues, type SellerSettings, type SellerSettingsData } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const KEYS: string[] = Object.values(SELLER_SETTING_KEYS);

/**
 * Seller details (M3.14, D41): one `Setting` row per field, written together. The order summary reads
 * `company.state` (M3.13) and invoices will read the rest (M3.21).
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async seller(): Promise<SellerSettings> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: KEYS } }, select: { key: true, value: true, updatedAt: true } });
    const updatedAt = rows.reduce<Date | null>((at, r) => (!at || r.updatedAt > at ? r.updatedAt : at), null);
    return readSellerSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])), updatedAt);
  }

  /** Saves every field in one transaction; the audit entry holds only the keys that changed. */
  async updateSeller(data: SellerSettingsData, actorId: string): Promise<SellerSettings> {
    // As stored: no `undefined` (an address without line2). jsonb also reorders keys, hence a deep compare.
    const values = JSON.parse(JSON.stringify(sellerSettingValues(data))) as Record<string, unknown>;
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
}
