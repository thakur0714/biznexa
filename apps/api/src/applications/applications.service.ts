import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  APPLICATION_STATUS_LABEL,
  calculatePrice,
  customerNextAction,
  formatApplicationCode,
  formatOrderCode,
  formDataValidator,
  formFileIds,
  type ApplicationDetail,
  type ApplicationStatus,
  type CreateApplicationData,
  type CustomerApplicationList,
  type CustomerApplicationListQuery,
  type DraftApplication,
  type FormSchema,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { ApplicationDocumentsService } from './application-documents.service';

const draftSelect = {
  id: true,
  code: true,
  status: true,
  serviceId: true,
  packageId: true,
  businessEntityId: true,
  formSchemaVersion: true,
  createdAt: true,
  order: { select: { id: true, code: true, status: true, total: true } },
} satisfies Prisma.ApplicationSelect;
type DraftRow = Prisma.ApplicationGetPayload<{ select: typeof draftSelect }>;

const detailSelect = {
  id: true,
  code: true,
  status: true,
  serviceId: true,
  packageId: true,
  businessEntityId: true,
  formSchemaVersion: true,
  formData: true,
  createdAt: true,
} satisfies Prisma.ApplicationSelect;
type DetailRow = Prisma.ApplicationGetPayload<{ select: typeof detailSelect }>;

/**
 * Customer applications (M3.8, D35). Starting one creates a draft order and a DRAFT application in one
 * transaction; codes come from database sequences so concurrent checkouts never share one.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ApplicationDocumentsService,
  ) {}

  /** Customer My Services list (M5.3): own applications filtered by tab, with context-aware nextAction. */
  async list(customerId: string, q: CustomerApplicationListQuery): Promise<CustomerApplicationList> {
    const statusFilter: Prisma.EnumApplicationStatusFilter | ApplicationStatus =
      q.tab === 'completed'
        ? { in: ['COMPLETED', 'DELIVERED'] }
        : q.tab === 'cancelled'
          ? 'CANCELLED'
          : { notIn: ['DRAFT', 'COMPLETED', 'DELIVERED', 'CANCELLED'] };

    const where: Prisma.ApplicationWhereInput = {
      customerId,
      status: statusFilter,
    };

    const [total, rows] = await Promise.all([
      this.prisma.application.count({ where }),
      this.prisma.application.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        select: {
          id: true,
          code: true,
          status: true,
          serviceId: true,
          packageId: true,
          createdAt: true,
          updatedAt: true,
          service: { select: { name: true, slug: true } },
          package: { select: { name: true } },
          order: { select: { total: true, amountPaid: true } },
        },
      }),
    ]);

    const items = await Promise.all(
      rows.map(async (r) => {
        const pendingMandatory = await this.documents.pendingMandatory({
          id: r.id,
          status: r.status,
          serviceId: r.serviceId,
          packageId: r.packageId,
        });
        const orderBalance = r.order ? Math.max(0, r.order.total - r.order.amountPaid) : 0;
        return {
          id: r.id,
          code: r.code,
          status: r.status,
          statusLabel: APPLICATION_STATUS_LABEL[r.status],
          serviceName: r.service.name,
          serviceSlug: r.service.slug,
          packageName: r.package.name,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          nextAction: customerNextAction({
            status: r.status,
            pendingMandatory,
            orderBalance,
          }),
        };
      }),
    );

    return {
      items,
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  /**
   * Starts an application for a package, or returns the customer's unpaid draft for the same package and
   * business (back button, second click, refresh). The form version current now is copied onto the
   * application and kept for its whole life.
   */
  async startDraft(customerId: string, input: CreateApplicationData): Promise<DraftApplication> {
    return this.prisma.$transaction(async (tx) => {
      // Serialises one customer's checkouts, so a double click cannot make two drafts.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${customerId} FOR UPDATE`;

      const pkg = await tx.servicePackage.findFirst({
        where: { id: input.packageId, isActive: true, service: { isActive: true, deletedAt: null } },
        select: {
          id: true,
          name: true,
          professionalFee: true,
          governmentFee: true,
          gstRate: true,
          service: { select: { id: true, name: true, sacCode: true } },
        },
      });
      if (!pkg) throw new NotFoundException('This package is no longer available. Choose a package again on the service page.');

      let buyerState: string | null = null;
      if (input.businessEntityId) {
        const entity = await tx.businessEntity.findFirst({
          where: { id: input.businessEntityId, ownerId: customerId, deletedAt: null },
          select: { state: true },
        });
        if (!entity) throw new NotFoundException('Business not found');
        buyerState = entity.state;
      }

      const existing = await tx.application.findFirst({
        where: { customerId, packageId: pkg.id, businessEntityId: input.businessEntityId, status: 'DRAFT', order: { status: 'CREATED' } },
        orderBy: { createdAt: 'desc' },
        select: draftSelect,
      });
      if (existing) return toDto(existing, true);

      const form = await tx.serviceFormSchema.findFirst({ where: { serviceId: pkg.service.id, isCurrent: true }, select: { version: true } });
      if (!form) {
        throw new ConflictException('This service cannot be applied for online yet. Use “Talk to an expert” on the service page and we will start it for you.');
      }

      // Provisional totals so the order is complete from the start; the order summary (M3.13) recomputes
      // them with the coupon and seller state. The total does not depend on CGST/SGST vs IGST.
      const price = calculatePrice({ professionalFee: pkg.professionalFee, governmentFee: pkg.governmentFee, gstRate: pkg.gstRate });
      const [orderNo, applicationNo] = await nextNumbers(tx);
      const now = new Date();

      const order = await tx.order.create({
        data: {
          code: formatOrderCode(orderNo, now),
          customerId,
          subtotal: price.professionalFee,
          taxTotal: price.totalTax,
          govtFees: price.governmentFee,
          total: price.total,
          buyerState,
          status: 'CREATED',
          createdAt: now,
          items: {
            create: {
              packageId: pkg.id,
              description: `${pkg.service.name} — ${pkg.name}`,
              sacCode: pkg.service.sacCode,
              professionalFee: pkg.professionalFee,
              governmentFee: pkg.governmentFee,
              gstRate: pkg.gstRate,
            },
          },
        },
        select: { id: true },
      });

      const application = await tx.application.create({
        data: {
          code: formatApplicationCode(applicationNo),
          orderId: order.id,
          customerId,
          serviceId: pkg.service.id,
          packageId: pkg.id,
          businessEntityId: input.businessEntityId,
          formSchemaVersion: form.version,
          status: 'DRAFT',
          createdAt: now,
          history: { create: { status: 'DRAFT', changedById: customerId, note: 'Application started', changedAt: now } },
        },
        select: draftSelect,
      });
      return toDto(application, false);
    });
  }

  /** The form page (M3.9): the customer's own application, with its saved answers and the exact form it was started on. */
  async get(customerId: string, id: string): Promise<ApplicationDetail> {
    const app = await this.find(customerId, id);
    if (app.formSchemaVersion == null) throw new ConflictException('This application has no form to fill in.');
    const form = await this.formForVersion(app.serviceId, app.formSchemaVersion);
    return toDetailDto(app, form);
  }

  /**
   * Autosave and final save of the form's answers (M3.9). Autosave (`final` false) checks only the
   * answers' shape, so half-typed input is kept; the final save checks every rule. Problems come back
   * as a 400 with field paths inside `formData` (`directors.1.pan`), like `ZodPipe`. File answers must
   * be files this customer uploaded. Only a DRAFT can change: the status is checked in the update
   * itself, so an application that moves on (payment) mid-request is never overwritten.
   */
  async updateFormData(customerId: string, id: string, formData: Record<string, unknown>, final = false): Promise<ApplicationDetail> {
    const app = await this.find(customerId, id);
    if (app.status !== 'DRAFT') throw notDraft();
    if (app.formSchemaVersion == null) throw new ConflictException('This application has no form to save answers against.');
    const form = await this.formForVersion(app.serviceId, app.formSchemaVersion);

    const parsed = formDataValidator(form, { partial: !final }).safeParse(formData);
    if (!parsed.success) {
      throw new BadRequestException({
        message: final ? 'Some answers are missing or not valid. Fix them before continuing.' : 'These answers could not be saved.',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }

    const files = formFileIds(form, parsed.data);
    if (files.length) {
      const owned = await this.prisma.storedFile.findMany({ where: { id: { in: files.map((f) => f.id) }, ownerId: customerId }, select: { id: true } });
      const ok = new Set(owned.map((f) => f.id));
      const foreign = files.filter((f) => !ok.has(f.id));
      if (foreign.length) {
        throw new BadRequestException({
          message: 'Some files could not be found. Upload them again.',
          errors: foreign.map((f) => ({ field: f.path.slice(0, -1).join('.'), message: 'Upload the file again' })),
        });
      }
    }

    const { count } = await this.prisma.application.updateMany({
      where: { id, customerId, status: 'DRAFT' },
      data: { formData: parsed.data as Prisma.InputJsonValue },
    });
    if (count === 0) throw notDraft();
    return toDetailDto(await this.find(customerId, id), form);
  }

  /**
   * Payment start (M3.16): the stored answers must pass every rule of the application's own form version.
   * The final save does not change the status, so nothing else records that the form was completed.
   * Problems are a 400 like the final save's, with paths inside `formData`.
   */
  async assertFormComplete(db: Prisma.TransactionClient, app: { serviceId: string; formSchemaVersion: number | null; formData: Prisma.JsonValue }): Promise<void> {
    if (app.formSchemaVersion == null) throw new ConflictException('This application has no form, so it can’t be paid for online.');
    const form = await this.formForVersion(app.serviceId, app.formSchemaVersion, db);
    const parsed = formDataValidator(form).safeParse(app.formData ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Some answers in your details are missing or not valid. Complete them before paying.',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
  }

  private async find(customerId: string, id: string): Promise<DetailRow> {
    const app = await this.prisma.application.findFirst({ where: { id, customerId }, select: detailSelect });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  private async formForVersion(serviceId: string, version: number, db: Prisma.TransactionClient = this.prisma): Promise<FormSchema> {
    const row = await db.serviceFormSchema.findUnique({ where: { serviceId_version: { serviceId, version } }, select: { schema: true } });
    if (!row) throw new ConflictException('This application’s form is no longer available.');
    return row.schema as unknown as FormSchema;
  }
}

const notDraft = () => new ConflictException('This application is no longer a draft, so its answers can’t be changed here.');

/** One number from each sequence (migration `order_application_codes`). */
async function nextNumbers(tx: Prisma.TransactionClient): Promise<[number, number]> {
  const [row] = await tx.$queryRaw<{ order_no: bigint; application_no: bigint }[]>`
    SELECT nextval('order_code_seq') AS order_no, nextval('application_code_seq') AS application_no`;
  return [Number(row.order_no), Number(row.application_no)];
}

function toDto(r: DraftRow, resumed: boolean): DraftApplication {
  // Every draft made here has an order and a form version; the casts only narrow the nullable columns.
  const order = r.order!;
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    serviceId: r.serviceId,
    packageId: r.packageId,
    businessEntityId: r.businessEntityId,
    formSchemaVersion: r.formSchemaVersion!,
    order: { id: order.id, code: order.code, status: order.status, total: order.total },
    createdAt: r.createdAt.toISOString(),
    resumed,
  };
}

function toDetailDto(r: DetailRow, form: FormSchema): ApplicationDetail {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    serviceId: r.serviceId,
    packageId: r.packageId,
    businessEntityId: r.businessEntityId,
    formSchemaVersion: r.formSchemaVersion!,
    formData: r.formData as Record<string, unknown>,
    formSchema: form,
    createdAt: r.createdAt.toISOString(),
  };
}
