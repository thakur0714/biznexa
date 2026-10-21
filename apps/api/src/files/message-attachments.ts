import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

/**
 * Files a sender may attach to a message (application or ticket thread): their own uploads, not infected,
 * and not already used by a document, deliverable, consultant document or another message.
 */
export async function checkMessageAttachments(tx: Prisma.TransactionClient, fileIds: string[] | undefined, senderId: string): Promise<string[]> {
  if (!fileIds?.length) return [];

  const files = await tx.storedFile.findMany({ where: { id: { in: fileIds } } });
  if (files.length !== fileIds.length) {
    throw new BadRequestException('One or more files could not be found.');
  }

  if (files.some((file) => file.ownerId !== senderId)) {
    throw new BadRequestException('One or more files belong to another user.');
  }
  if (files.some((file) => file.scanStatus === 'INFECTED')) {
    throw new BadRequestException('A virus was found in one of the files. Please upload a clean copy.');
  }

  // One query per kind of use, for all the files at once (all inside the caller's transaction).
  const fileKeys = files.map((file) => file.fileKey);
  const [doc, deliv, cDoc, msgAttach] = await Promise.all([
    tx.applicationDocument.findFirst({ where: { fileKey: { in: fileKeys } } }),
    tx.finalDeliverable.findFirst({ where: { fileKey: { in: fileKeys } } }),
    tx.consultantDocument.findFirst({ where: { fileId: { in: fileIds } } }),
    tx.messageAttachment.findFirst({ where: { fileId: { in: fileIds } } }),
  ]);
  if (doc) throw new BadRequestException('One or more files are already used by a document.');
  if (deliv) throw new BadRequestException('One or more files are already used by a deliverable.');
  if (cDoc) throw new BadRequestException('One or more files are already used by a consultant document.');
  if (msgAttach) throw new BadRequestException('One or more files are already attached to another message.');

  return fileIds;
}
