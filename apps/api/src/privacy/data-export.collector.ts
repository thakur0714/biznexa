import type { PrismaService } from '../prisma/prisma.service';
import { decryptField } from '../common/encryption';
import { openFormData } from '../applications/sensitive-form-data';
import type { ZipEntry } from './zip';

/**
 * Everything the export ZIP holds for one customer (M5.12), as JSON files. Every query is keyed by the user's
 * own id (or by records that are theirs: their applications, orders, bookings, tickets), so nothing of another
 * customer can end up in it. Left out on purpose: secrets (password hash, 2FA, tokens), internal staff notes,
 * stage history hidden from the customer, raw gateway webhooks, file contents (the document list only).
 */
export async function collectExport(prisma: PrismaService, userId: string, now = new Date()): Promise<ZipEntry[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { customerProfile: true } });
  const mine = { customerId: userId };

  const [businesses, applications, orders, invoices, creditNotes, tickets, bookings, notifications] = await Promise.all([
    prisma.businessEntity.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.application.findMany({
      where: mine,
      orderBy: { createdAt: 'asc' },
      include: {
        service: { select: { name: true } },
        package: { select: { name: true } },
        businessEntity: { select: { legalName: true } },
        history: { where: { visibleToCustomer: true }, orderBy: { changedAt: 'asc' }, select: { status: true, note: true, changedAt: true, stage: { select: { name: true } } } },
        documents: { orderBy: [{ name: 'asc' }, { version: 'asc' }] },
        deliverables: { select: { title: true, fileName: true, createdAt: true } },
      },
    }),
    prisma.order.findMany({ where: mine, orderBy: { createdAt: 'asc' }, include: { items: true, payments: { include: { refunds: true } } } }),
    prisma.invoice.findMany({ where: mine, orderBy: { issuedAt: 'asc' } }),
    prisma.creditNote.findMany({ where: mine, orderBy: { issuedAt: 'asc' } }),
    prisma.ticket.findMany({ where: mine, orderBy: { createdAt: 'asc' } }),
    prisma.booking.findMany({
      where: mine,
      orderBy: { startAt: 'asc' },
      include: { consultant: { select: { user: { select: { name: true } } } }, payments: { include: { refunds: true } }, review: true },
    }),
    prisma.notification.findMany({ where: { userId, channel: 'IN_APP' }, orderBy: { createdAt: 'asc' } }),
  ]);

  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [
        { application: { customerId: userId } },
        { booking: { customerId: userId } },
        { ticket: { customerId: userId } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    include: {
      application: { select: { code: true } },
      booking: { select: { code: true } },
      ticket: { select: { code: true } },
      messages: { orderBy: { createdAt: 'asc' }, include: { messageAttachments: { select: { file: { select: { originalName: true } } } } } },
    },
  });

  const payment = (p: (typeof orders)[number]['payments'][number]) => ({
    id: p.id,
    amount: p.amount,
    method: p.method,
    status: p.status,
    failureReason: p.failureReason,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
    refunds: p.refunds.map((r) => ({ amount: r.amount, reason: r.reason, status: r.status, processedAt: r.processedAt, creditNoteNo: r.creditNoteNo, createdAt: r.createdAt })),
  });

  const files: Record<string, unknown> = {
    'profile.json': {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      emailVerified: user.emailVerified,
      mobileVerified: user.mobileVerified,
      signInWithGoogle: !!user.googleId,
      consentAt: user.consentAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      notificationPreferences: user.notificationPrefs,
      address: user.customerProfile && {
        pan: user.customerProfile.panMasked,
        address: user.customerProfile.address,
        city: user.customerProfile.city,
        state: user.customerProfile.state,
        pincode: user.customerProfile.pincode,
      },
    },
    'business-entities.json': businesses.map((b) => ({
      id: b.id,
      legalName: b.legalName,
      entityType: b.entityType,
      gstin: b.gstin,
      cin: b.cin,
      pan: b.pan ? decryptField(b.pan) : null,
      address: b.address,
      state: b.state,
      createdAt: b.createdAt,
      removedAt: b.deletedAt,
    })),
    'applications.json': applications.map((a) => ({
      id: a.id,
      code: a.code,
      service: a.service.name,
      package: a.package.name,
      business: a.businessEntity?.legalName ?? null,
      status: a.status,
      formData: openFormData(a.formData, true),
      submittedAt: a.submittedAt,
      completedAt: a.completedAt,
      createdAt: a.createdAt,
      history: a.history.map((h) => ({ status: h.status, stage: h.stage?.name ?? null, note: h.note, at: h.changedAt })),
      deliverables: a.deliverables,
    })),
    'documents.json': applications.flatMap((a) =>
      a.documents.map((d) => ({
        application: a.code,
        name: d.name,
        version: d.version,
        latest: d.isLatest,
        status: d.status,
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        rejectionReason: d.rejectionReason,
        uploadedAt: d.uploadedAt,
        reviewedAt: d.reviewedAt,
      })),
    ),
    'orders.json': orders.map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      subtotal: o.subtotal,
      discount: o.discount,
      taxTotal: o.taxTotal,
      govtFees: o.govtFees,
      total: o.total,
      amountPaid: o.amountPaid,
      createdAt: o.createdAt,
      items: o.items.map((i) => ({ description: i.description, sacCode: i.sacCode, professionalFee: i.professionalFee, governmentFee: i.governmentFee, discount: i.discount, gstRate: i.gstRate })),
    })),
    'payments.json': [
      ...orders.flatMap((o) => o.payments.map((p) => ({ for: { order: o.code }, ...payment(p) }))),
      ...bookings.flatMap((b) => b.payments.map((p) => ({ for: { booking: b.code }, ...payment(p) }))),
    ],
    'invoices.json': invoices.map((i) => ({
      number: i.number,
      issuedAt: i.issuedAt,
      seller: i.seller,
      buyer: i.buyer,
      placeOfSupply: i.placeOfSupply,
      taxType: i.taxType,
      lines: i.lines,
      taxableValue: i.taxableValue,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      govtFees: i.govtFees,
      discount: i.discount,
      total: i.total,
    })),
    'credit-notes.json': creditNotes.map((c) => ({
      number: c.number,
      issuedAt: c.issuedAt,
      reason: c.reason,
      lines: c.lines,
      taxableValue: c.taxableValue,
      cgst: c.cgst,
      sgst: c.sgst,
      igst: c.igst,
      govtFees: c.govtFees,
      total: c.total,
    })),
    'messages.json': conversations.map((c) => ({
      about: c.application ? { application: c.application.code } : c.booking ? { booking: c.booking.code } : { ticket: c.ticket?.code ?? null },
      messages: c.messages.map((m) => ({
        from: m.senderId === userId ? 'you' : 'BizNexa',
        body: m.body,
        attachments: m.messageAttachments.map((a) => a.file.originalName),
        sentAt: m.createdAt,
      })),
    })),
    'tickets.json': tickets.map((t) => ({
      code: t.code,
      subject: t.subject,
      description: t.description,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt,
    })),
    'bookings.json': bookings.map((b) => ({
      code: b.code,
      consultant: b.consultant.user.name,
      type: b.type,
      startAt: b.startAt,
      endAt: b.endAt,
      fee: b.fee,
      status: b.status,
      notes: b.notes,
      review: b.review && { rating: b.review.rating, text: b.review.text, createdAt: b.review.createdAt },
      createdAt: b.createdAt,
    })),
    'notifications.json': notifications.map((n) => ({ event: n.event, title: n.title, body: n.body, readAt: n.readAt, createdAt: n.createdAt })),
  };

  const readme = [
    'BizNexa — your data export',
    `Prepared: ${now.toISOString()}`,
    '',
    'Each file is JSON. Amounts are in paise (₹1 = 100 paise); dates are UTC (ISO 8601).',
    'Uploaded documents are listed in documents.json; download the files themselves from your dashboard.',
    'Questions: reply to the email that brought you this file or open a support ticket.',
    '',
  ].join('\n');

  return [{ name: 'README.txt', data: readme }, ...Object.entries(files).map(([name, data]) => ({ name, data: JSON.stringify(data, null, 2) }))];
}
