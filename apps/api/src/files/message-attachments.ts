import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

/**
 * Files a sender may attach to a message (application or ticket thread): their own uploads, not infected,
 * and not already used by a document, deliverable, consultant document or another message.
 */
export async function checkMessageAttachments(tx: Prisma.TransactionClient, fileIds: string[] | undefined, senderId: string): Promise<string[]> {
  if (!fileIds || !fileIds.length) return [];

  const files = await tx.storedFile.findMany({ where: { id: { in: fileIds } } });
  if (files.length !== fileIds.length) {
    throw new BadRequestException('One or more files could not be found.');
  }

  for (const file of files) {
    if (file.ownerId !== senderId) {
      throw new BadRequestException('One or more files belong to another user.');
    }
    if (file.scanStatus === 'INFECTED') {
      throw new BadRequestException('A virus was found in one of the files. Please upload a clean copy.');
    }

    const doc = await tx.applicationDocument.findFirst({ where: { fileKey: file.fileKey } });
    if (doc) throw new BadRequestException('One or more files are already used by a document.');

    const deliv = await tx.finalDeliverable.findFirst({ where: { fileKey: file.fileKey } });
    if (deliv) throw new BadRequestException('One or more files are already used by a deliverable.');

    const cDoc = await tx.consultantDocument.findFirst({ where: { fileId: file.id } });
    if (cDoc) throw new BadRequestException('One or more files are already used by a consultant document.');

    const msgAttach = await tx.messageAttachment.findFirst({ where: { fileId: file.id } });
    if (msgAttach) throw new BadRequestException('One or more files are already attached to another message.');
  }

  return fileIds;
}
