import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import {
  formSchema,
  formSchemaSize,
  type FormSchema,
  type FormSchemaVersion,
  type FormSchemaVersionList,
  type FormSchemaVersionRef,
  type SaveFormSchemaInput,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../generated/prisma/client';

type Row = { id: string; serviceId: string; version: number; isCurrent: boolean; createdAt: Date; schema: Prisma.JsonValue };

/**
 * Versioned application forms (D30). A save always inserts version N+1 — rows are never updated except
 * for the `isCurrent` flag — so applications keep the exact form they were started on.
 */
@Injectable()
export class FormSchemasService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(serviceId: string): Promise<FormSchemaVersionList> {
    await this.findService(serviceId);
    const [rows, used] = await Promise.all([
      this.prisma.serviceFormSchema.findMany({ where: { serviceId }, orderBy: { version: 'desc' } }),
      this.usage(serviceId),
    ]);
    return {
      latest: rows[0]?.version ?? null,
      current: rows.find((r) => r.isCurrent)?.version ?? null,
      versions: rows.map(({ schema, ...r }) => {
        const parsed = formSchema.safeParse(schema);
        return { ...this.meta(r, used), ...(parsed.success ? formSchemaSize(parsed.data) : { steps: 0, fields: 0 }) };
      }),
    };
  }

  async get(serviceId: string, ref: FormSchemaVersionRef): Promise<FormSchemaVersion> {
    await this.findService(serviceId);
    const where: Prisma.ServiceFormSchemaWhereInput =
      ref === 'current' ? { serviceId, isCurrent: true } : ref === 'latest' ? { serviceId } : { serviceId, version: ref };
    const row = await this.prisma.serviceFormSchema.findFirst({ where, orderBy: { version: 'desc' } });
    if (!row) throw new NotFoundException(ref === 'current' ? 'This service has no active form yet' : 'Form version not found');
    return this.toVersion(row, await this.usage(serviceId, row.version));
  }

  /** Saves the form as version N+1; with `activate` it becomes the version new applications use. */
  async save(serviceId: string, input: SaveFormSchemaInput & { activate: boolean }, actorId: string): Promise<FormSchemaVersion> {
    // Stored normalised (defaults filled in), so later changes to defaults cannot change an old version.
    const schema = formSchema.parse(input.schema);
    const { row, previous } = await this.prisma.$transaction(async (tx) => {
      await this.lockService(tx, serviceId);
      const last = await tx.serviceFormSchema.findFirst({ where: { serviceId }, orderBy: { version: 'desc' }, select: { version: true } });
      const previous = await tx.serviceFormSchema.findFirst({ where: { serviceId, isCurrent: true }, select: { version: true } });
      if (input.activate) await tx.serviceFormSchema.updateMany({ where: { serviceId, isCurrent: true }, data: { isCurrent: false } });
      const row = await tx.serviceFormSchema.create({
        data: { serviceId, version: (last?.version ?? 0) + 1, schema: schema as Prisma.InputJsonValue, isCurrent: input.activate },
      });
      return { row, previous: previous?.version ?? null };
    });
    await this.audit.log({
      actorId,
      action: 'service.form_schema.create',
      entityType: 'Service',
      entityId: serviceId,
      before: { currentVersion: previous },
      after: { version: row.version, activated: input.activate, schema },
    });
    return this.toVersion(row, 0);
  }

  /** Makes an existing version the current one (e.g. roll back to an earlier form). */
  async activate(serviceId: string, version: number, actorId: string): Promise<FormSchemaVersion> {
    const { row, previous } = await this.prisma.$transaction(async (tx) => {
      await this.lockService(tx, serviceId);
      const row = await tx.serviceFormSchema.findUnique({ where: { serviceId_version: { serviceId, version } } });
      if (!row) throw new NotFoundException('Form version not found');
      const previous = await tx.serviceFormSchema.findFirst({ where: { serviceId, isCurrent: true }, select: { version: true } });
      if (previous?.version === version) return { row, previous: version };
      await tx.serviceFormSchema.updateMany({ where: { serviceId, isCurrent: true }, data: { isCurrent: false } });
      return { row: await tx.serviceFormSchema.update({ where: { id: row.id }, data: { isCurrent: true } }), previous: previous?.version ?? null };
    });
    if (previous !== version) {
      await this.audit.log({
        actorId,
        action: 'service.form_schema.activate',
        entityType: 'Service',
        entityId: serviceId,
        before: { currentVersion: previous },
        after: { currentVersion: version },
      });
    }
    return this.toVersion(row, await this.usage(serviceId, version));
  }

  private async findService(id: string) {
    const s = await this.prisma.service.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!s) throw new NotFoundException('Service not found');
  }

  /** Locks the service row so concurrent saves get consecutive version numbers and only one stays current. */
  private async lockService(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Service" WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Service not found');
  }

  /** Application counts per form version of a service (one query). */
  private async usage(serviceId: string): Promise<Map<number, number>>;
  private async usage(serviceId: string, version: number): Promise<number>;
  private async usage(serviceId: string, version?: number) {
    if (version !== undefined) return this.prisma.application.count({ where: { serviceId, formSchemaVersion: version } });
    const groups = await this.prisma.application.groupBy({ by: ['formSchemaVersion'], where: { serviceId }, _count: { _all: true } });
    return new Map(groups.map((g) => [g.formSchemaVersion, g._count._all]));
  }

  private meta(r: Omit<Row, 'schema'>, used: Map<number | null, number>) {
    return { id: r.id, serviceId: r.serviceId, version: r.version, isCurrent: r.isCurrent, createdAt: r.createdAt.toISOString(), applications: used.get(r.version) ?? 0 };
  }

  private toVersion(r: Row, applications: number): FormSchemaVersion {
    return { ...this.meta(r, new Map([[r.version, applications]])), schema: this.parse(r.schema) };
  }

  /** Stored forms were validated when saved; a row that no longer parses (e.g. edited in SQL) is reported, not served. */
  private parse(json: Prisma.JsonValue): FormSchema {
    const res = formSchema.safeParse(json);
    if (!res.success) throw new InternalServerErrorException('This form version is damaged — save a corrected version');
    return res.data;
  }
}
