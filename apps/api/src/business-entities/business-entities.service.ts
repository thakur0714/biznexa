import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessAddressSchema,
  MAX_BUSINESS_ENTITIES,
  type BusinessEntity,
  type BusinessEntityData,
  type BusinessEntityList,
  type EntityType,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { decryptField, encryptField } from '../common/encryption';
import { Prisma } from '../generated/prisma/client';

type Row = Prisma.BusinessEntityGetPayload<object>;

/**
 * A customer's saved businesses (M3.7, D34). Every query is scoped to the owner, so another
 * customer's business looks exactly like a missing one (404). The PAN is encrypted at rest.
 */
@Injectable()
export class BusinessEntitiesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<BusinessEntityList> {
    const rows = await this.prisma.businessEntity.findMany({ where: { ownerId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    return { items: rows.map(toDto) };
  }

  async get(ownerId: string, id: string): Promise<BusinessEntity> {
    return toDto(await this.find(this.prisma, ownerId, id));
  }

  async create(ownerId: string, data: BusinessEntityData): Promise<BusinessEntity> {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, ownerId);
      const count = await tx.businessEntity.count({ where: { ownerId, deletedAt: null } });
      if (count >= MAX_BUSINESS_ENTITIES) throw new BadRequestException(`You can save up to ${MAX_BUSINESS_ENTITIES} businesses. Remove one you no longer use first.`);
      await this.checkDuplicate(tx, ownerId, data.gstin);
      return tx.businessEntity.create({ data: { ownerId, ...toRow(data) } });
    });
    return toDto(row);
  }

  /** Replaces the whole business (PUT). */
  async update(ownerId: string, id: string, data: BusinessEntityData): Promise<BusinessEntity> {
    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, ownerId);
      await this.find(tx, ownerId, id);
      await this.checkDuplicate(tx, ownerId, data.gstin, id);
      return tx.businessEntity.update({ where: { id }, data: toRow(data) });
    });
    return toDto(row);
  }

  /** Soft delete: applications and certificates that point at the business keep it. */
  async remove(ownerId: string, id: string) {
    await this.find(this.prisma, ownerId, id);
    await this.prisma.businessEntity.update({ where: { id }, data: { deletedAt: new Date() } });
    return { message: 'Business removed' };
  }

  private async find(db: Prisma.TransactionClient, ownerId: string, id: string): Promise<Row> {
    const row = await db.businessEntity.findFirst({ where: { id, ownerId, deletedAt: null } });
    if (!row) throw new NotFoundException('Business not found');
    return row;
  }

  /** Serialises a customer's writes so the limit and the duplicate-GSTIN check hold under concurrency. */
  private async lockOwner(tx: Prisma.TransactionClient, ownerId: string) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId} FOR UPDATE`;
  }

  private async checkDuplicate(tx: Prisma.TransactionClient, ownerId: string, gstin: string | null, exceptId?: string) {
    if (!gstin) return;
    const other = await tx.businessEntity.findFirst({ where: { ownerId, gstin, deletedAt: null, ...(exceptId && { id: { not: exceptId } }) }, select: { id: true } });
    if (other) {
      throw new ConflictException({ message: 'You have already saved a business with this GSTIN', errors: [{ field: 'gstin', message: 'You have already saved a business with this GSTIN' }] });
    }
  }
}

function toRow(d: BusinessEntityData) {
  return {
    legalName: d.legalName,
    entityType: d.entityType,
    pan: d.pan ? encryptField(d.pan) : null,
    gstin: d.gstin,
    cin: d.cin,
    address: d.address ?? Prisma.DbNull,
    state: d.state,
  };
}

function toDto(r: Row): BusinessEntity {
  const address = businessAddressSchema.safeParse(r.address);
  return {
    id: r.id,
    legalName: r.legalName,
    entityType: r.entityType as EntityType,
    pan: r.pan ? decryptField(r.pan) : null,
    gstin: r.gstin,
    cin: r.cin,
    address: address.success ? address.data : null,
    state: r.state,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
