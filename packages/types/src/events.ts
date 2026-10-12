/**
 * Domain events (PROMPT §10 Extensibility): things that happened, published by API services
 * after the change is saved, so notifications, automation and AI can react without the
 * service knowing about them. Payloads are plain JSON (ISO date strings) so a listener can
 * hand them straight to a queue job or a webhook.
 *
 * Adding an event: add its payload here, then emit it from the service that owns the change.
 */
import type { ApplicationStatus, CertificateStatus } from './status';
import type { FileScanStatus } from './uploads';

export interface DomainEventPayloads {
  'application.status_changed': {
    applicationId: string;
    from: ApplicationStatus;
    to: ApplicationStatus;
    /** Staff or customer who made the change; null for the system (webhook, scheduler). */
    actorId: string | null;
    reason?: string;
  };
  'certificate.issued': {
    certificateId: string;
    certificateNumber: string;
    status: CertificateStatus;
    actorId: string;
  };
  'certificate.status_changed': {
    certificateId: string;
    certificateNumber: string;
    from: CertificateStatus;
    to: CertificateStatus;
    actorId: string | null;
    reason?: string;
  };
  /** A customer added or replaced a document on an application (M3.10); `version` > 1 is a replacement. */
  'document.uploaded': {
    documentId: string;
    applicationId: string;
    requirementId: string;
    version: number;
    actorId: string;
  };
  /**
   * A verified gateway webhook confirmed an order's payment (M3.17). Emitted once per payment, after the
   * order is PAID (or PARTIALLY_PAID for an advance, M3.19) and its applications are submitted.
   * `applicationIds` are the applications this payment submitted — empty for a balance payment.
   * Invoices (M3.21) and notifications listen to this.
   */
  'payment.succeeded': {
    paymentId: string;
    orderId: string;
    customerId: string;
    applicationIds: string[];
    /** Integer paise. */
    amount: number;
    gateway: string;
    gatewayPaymentId: string;
  };
  /** A payment attempt failed at the gateway (M3.17); the order stays PAYMENT_PENDING and can be paid again. */
  'payment.failed': {
    paymentId: string;
    orderId: string;
    customerId: string;
    amount: number;
    /** The gateway's reason, safe to show the customer. */
    reason: string | null;
  };
  /**
   * An invoice was issued for a successful payment (M3.21): one per payment, so an advance and its balance
   * each get one. The PDF (M3.22–M3.23) and the "invoice issued" notification (M6) listen to this.
   */
  'invoice.issued': {
    invoiceId: string;
    number: string;
    paymentId: string;
    orderId: string;
    customerId: string;
    /** Integer paise; equals the payment. */
    total: number;
  };
  /**
   * A PDF was rendered and stored (M3.22): `kind` is the registered document kind (`invoice`, `certificate`…),
   * `id` its record, `fileKey` the `StorageService` key now saved on that record.
   */
  'pdf.generated': {
    kind: string;
    id: string;
    fileKey: string;
    sizeBytes: number;
  };
  'file.scanned': {
    fileId: string;
    ownerId: string;
    status: Exclude<FileScanStatus, 'PENDING'>;
    /** What the scanner found, when INFECTED. */
    signature: string | null;
  };
}

export type DomainEventName = keyof DomainEventPayloads;

/** What listeners receive. */
export interface DomainEvent<K extends DomainEventName = DomainEventName> {
  name: K;
  /** Unique per emit; use it to make listeners idempotent. */
  id: string;
  occurredAt: string;
  payload: DomainEventPayloads[K];
}

/** A union of every event, narrowed by `name` (for `onAny` listeners). */
export type AnyDomainEvent = { [K in DomainEventName]: DomainEvent<K> }[DomainEventName];
