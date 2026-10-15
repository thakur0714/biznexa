import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_ACCEPTED_TYPES,
  DEFAULT_MAX_UPLOAD_MB,
  isKnownFileType,
  PERMS,
  type FileLinkResult,
  type FileMimeType,
  type StoredFileResult,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { applicationScope } from '../applications/application-access';
import type { AuthUser } from '../common/auth.decorators';
import { env } from '../config/env';
import { StorageService } from './storage.service';
import { FileScanService } from './file-scan.service';
import type { StoredFile } from '../generated/prisma/client';

/** What one upload may be: from the document requirement, or the defaults (PROMPT §7.4). */
export interface UploadPolicy {
  requirementId: string | null;
  acceptedTypes: FileMimeType[];
  maxBytes: number;
}

/** A file multer has written to storage, before it has a database row. */
export interface UploadedFile {
  fileKey: string;
  originalName: string;
  mimeType: FileMimeType;
  sizeBytes: number;
  sha256: string;
}

export type Disposition = 'attachment' | 'inline';

export const LINK_TTL_SECONDS = 5 * 60;
const MB = 1024 * 1024;

/** Strip folders, control characters and quotes; keep it short. Only ever used in Content-Disposition. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  if (!cleaned) return 'file';
  if (cleaned.length <= 150) return cleaned;
  const ext = cleaned.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '';
  return cleaned.slice(0, 150 - ext.length) + ext;
}

/** RFC 6266 header with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(type: Disposition, name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger('Files');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scans: FileScanService,
  ) {}

  async policyFor(requirementId?: string): Promise<UploadPolicy> {
    const cap = env().UPLOAD_MAX_MB * MB;
    if (!requirementId) return { requirementId: null, acceptedTypes: DEFAULT_ACCEPTED_TYPES, maxBytes: Math.min(DEFAULT_MAX_UPLOAD_MB * MB, cap) };

    const req = await this.prisma.serviceDocumentRequirement.findUnique({ where: { id: requirementId } });
    if (!req) throw new BadRequestException('Unknown document requirement');
    const unknown = req.acceptedTypes.filter((t) => !isKnownFileType(t));
    if (unknown.length) this.logger.warn(`Requirement ${req.id} lists types the API cannot verify, ignored: ${unknown.join(', ')}`);
    const acceptedTypes = req.acceptedTypes.filter(isKnownFileType);
    if (!acceptedTypes.length) throw new BadRequestException('This document does not accept uploads of any supported file type');
    return { requirementId: req.id, acceptedTypes, maxBytes: Math.min(req.maxSizeMb * MB, cap) };
  }

  /**
   * Save the database row for a file already in storage and queue its virus scan; the file is PENDING
   * (not downloadable) until the scan says CLEAN. If saving fails, the stored bytes are removed.
   */
  async record(file: UploadedFile, ownerId: string, policy: UploadPolicy): Promise<StoredFileResult> {
    let row: StoredFile;
    try {
      row = await this.prisma.storedFile.create({
        data: { ...file, ownerId, requirementId: policy.requirementId },
      });
    } catch (err) {
      await this.storage.remove(file.fileKey).catch((e) => this.logger.error(`Could not remove ${file.fileKey}: ${e}`));
      throw err;
    }
    this.scans.enqueue(row.id);
    return toResult(row);
  }

  /**
   * Who may read a file: its uploader, or staff who can see every application.
   * M4 adds operations staff assigned to the application the file belongs to.
   */
  private async canRead(user: AuthUser, file: StoredFile) {
    if (file.ownerId === user.id || user.permissions.includes(PERMS.APPLICATIONS_VIEW_ALL)) return true;

    if (user.permissions.includes(PERMS.APPLICATIONS_VIEW_ASSIGNED)) {
      const doc = await this.prisma.applicationDocument.findFirst({
        where: {
          fileKey: file.fileKey,
          application: applicationScope(user),
        },
      });
      if (doc) return true;
    }

    return false;
  }

  /** A file's details, including its scan status (clients poll this after uploading). */
  async get(id: string, user: AuthUser): Promise<StoredFileResult> {
    return toResult(await this.findReadable(id, user));
  }

  /** No access looks the same as no file. */
  private async findReadable(id: string, user: AuthUser) {
    const file = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!file || !(await this.canRead(user, file))) throw new NotFoundException('File not found');
    return file;
  }

  /** Permission check and virus-scan check, then a signed link valid for 5 minutes. */
  async createLink(id: string, user: AuthUser, disposition: Disposition, now = Date.now()): Promise<FileLinkResult> {
    const file = await this.findReadable(id, user);
    assertClean(file);
    return signedLink('files', id, disposition, now);
  }

  /** Check a signed link and open the file. */
  async openLinked(id: string, q: { e?: string; d?: string; s?: string }, now = Date.now()) {
    const disposition = checkSignedLink('files', id, q, now);
    const file = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('File not found');
    assertClean(file);
    const { stream, size } = await this.storage.read(file.fileKey);
    return { file, stream, size, disposition: contentDisposition(disposition, file.originalName) };
  }
}

/** Only files the virus scan passed can be downloaded: not while PENDING, never when INFECTED. */
function assertClean(file: StoredFile) {
  if (file.scanStatus === 'INFECTED') throw new GoneException('This file was blocked because a virus was found in it. Please upload a clean copy.');
  if (file.scanStatus !== 'CLEAN') throw new ConflictException('This file is still being checked for viruses. Please try again in a minute.');
}

/**
 * What a signed link opens: `/api/<scope>/<id>/download`. Stored files (D17) and invoice PDFs (M3.23) share
 * the secret; the scope is part of what is signed, so a link for one can never open the other.
 */
export type LinkScope = 'files' | 'invoices' | 'certificates';

function sign(scope: LinkScope, id: string, expires: number, disposition: Disposition) {
  // Files sign the bare id, as they did before invoices had links.
  const subject = scope === 'files' ? id : `${scope}:${id}`;
  return createHmac('sha256', env().FILE_LINK_SECRET).update(`${subject}.${expires}.${disposition}`).digest('base64url');
}

export function signedPath(id: string, expires: number, disposition: Disposition, scope: LinkScope = 'files') {
  const q = new URLSearchParams({ e: String(expires), d: disposition, s: sign(scope, id, expires, disposition) });
  return `/api/${scope}/${id}/download?${q}`;
}

/** A signed download link valid for 5 minutes. Check permission first: the link itself is the permission. */
export function signedLink(scope: LinkScope, id: string, disposition: Disposition, now = Date.now()): FileLinkResult {
  const expires = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  return { url: signedPath(id, expires, disposition, scope), expiresAt: new Date(expires * 1000).toISOString() };
}

/** Checks a signed link's signature and expiry; returns its disposition. */
export function checkSignedLink(scope: LinkScope, id: string, q: { e?: string; d?: string; s?: string }, now = Date.now()): Disposition {
  const expires = Number(q.e);
  const disposition = q.d === 'inline' ? 'inline' : 'attachment';
  if (!q.s || !Number.isInteger(expires) || !safeEqual(sign(scope, id, expires, disposition), q.s)) {
    throw new ForbiddenException('This download link is not valid');
  }
  if (expires * 1000 < now) throw new ForbiddenException('This download link has expired. Please try again.');
  return disposition;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function toResult(row: StoredFile): StoredFileResult {
  return {
    id: row.id,
    fileName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    requirementId: row.requirementId,
    scanStatus: row.scanStatus,
    createdAt: row.createdAt.toISOString(),
  };
}
