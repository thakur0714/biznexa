import { describe, expect, it } from 'vitest';
import {
  attachDocumentInput,
  canReplaceDocument,
  canUploadDocuments,
  needsUpload,
  pendingMandatoryCount,
  requirementApplies,
  requirementFileTypes,
  type ApplicationDocumentResult,
} from './index';

const doc = (over: Partial<ApplicationDocumentResult> = {}): ApplicationDocumentResult => ({
  id: '00000000-0000-4000-8000-000000000001',
  version: 1,
  status: 'UPLOADED',
  rejectionReason: null,
  fileId: '00000000-0000-4000-8000-000000000002',
  fileName: 'pan.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1000,
  scanStatus: 'CLEAN',
  uploadedAt: '2026-10-11T10:00:00.000Z',
  ...over,
});
const req = (isMandatory: boolean) => ({ isMandatory });

describe('document checklist helpers (M3.10)', () => {
  it('applies a requirement to every package when it names none, else only to the named ones', () => {
    expect(requirementApplies({ packageIds: [] }, 'basic')).toBe(true);
    expect(requirementApplies({ packageIds: ['premium'] }, 'premium')).toBe(true);
    expect(requirementApplies({ packageIds: ['premium'] }, 'basic')).toBe(false);
  });

  it('keeps only file types the API can verify', () => {
    expect(requirementFileTypes(['application/pdf', 'application/msword', 'image/png'])).toEqual(['application/pdf', 'image/png']);
  });

  it('lets the customer upload until the application is past document collection', () => {
    for (const s of ['DRAFT', 'PAYMENT_PENDING', 'SUBMITTED', 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_PENDING']) expect(canUploadDocuments(s)).toBe(true);
    for (const s of ['DOCUMENTS_APPROVED', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED', 'CANCELLED']) expect(canUploadDocuments(s)).toBe(false);
  });

  it('replaces only uploads that are waiting or rejected', () => {
    expect(canReplaceDocument('UPLOADED')).toBe(true);
    expect(canReplaceDocument('REJECTED')).toBe(true);
    expect(canReplaceDocument('UNDER_REVIEW')).toBe(false);
    expect(canReplaceDocument('APPROVED')).toBe(false);
  });

  it('counts mandatory documents with nothing usable as pending; a file still being scanned counts as uploaded', () => {
    expect(needsUpload({ current: null })).toBe(true);
    expect(needsUpload({ current: doc({ status: 'REJECTED', rejectionReason: 'Not readable' }) })).toBe(true);
    expect(needsUpload({ current: doc({ scanStatus: 'INFECTED' }) })).toBe(true);
    expect(needsUpload({ current: doc({ scanStatus: 'PENDING' }) })).toBe(false);
    expect(needsUpload({ current: doc({ status: 'APPROVED' }) })).toBe(false);

    const items = [
      { requirement: req(true), current: null },
      { requirement: req(true), current: doc() },
      { requirement: req(false), current: null }, // optional: never pending
      { requirement: req(true), current: doc({ status: 'REJECTED' }) },
    ];
    expect(pendingMandatoryCount(items)).toBe(2);
    expect(pendingMandatoryCount([])).toBe(0);
  });

  it('accepts only a file id in the attach body', () => {
    expect(attachDocumentInput.safeParse({ fileId: '00000000-0000-4000-8000-000000000002' }).success).toBe(true);
    expect(attachDocumentInput.safeParse({ fileId: 'abc' }).success).toBe(false);
    expect(attachDocumentInput.safeParse({}).error?.issues[0].message).toBe('Upload a file first');
    expect(attachDocumentInput.safeParse({ fileId: '00000000-0000-4000-8000-000000000002', version: 1 }).success).toBe(false);
  });
});
