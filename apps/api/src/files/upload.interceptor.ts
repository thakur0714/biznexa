import {
  BadRequestException,
  HttpException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer, { MulterError, type StorageEngine } from 'multer';
import { describeFileTypes, FILE_TYPES, fileTypeFromName } from '@biznexa/types';
import { FileContentMismatchError, FileInspector } from './file-type';
import { cleanFileName, FilesService, type UploadedFile, type UploadPolicy } from './files.service';
import { newFileKey, StorageService } from './storage.service';

/** The request after UploadInterceptor: the stored file and the rules it passed. */
export interface UploadRequest extends Request {
  upload: { file: UploadedFile; policy: UploadPolicy };
}

/** Multer engine: random key, content check and hashing while streaming into StorageService. */
class InspectingStorage implements StorageEngine {
  constructor(private readonly storage: StorageService) {}

  _handleFile(_req: Request, file: Express.Multer.File, cb: (error?: unknown, info?: Partial<Express.Multer.File> & { upload?: UploadedFile }) => void) {
    // fileFilter has already accepted the extension, so the expected type is known.
    const expected = fileTypeFromName(file.originalname)!;
    const inspector = new FileInspector(expected, FILE_TYPES[expected].label);
    const fileKey = newFileKey();
    // The check can fail before storage starts reading (it may await a mkdir first); keep the
    // error instead of letting it surface as an unhandled stream error.
    let rejected: Error | undefined;
    inspector.once('error', (err) => (rejected = err));
    this.storage
      .write(fileKey, file.stream.pipe(inspector))
      .then(() =>
        cb(null, {
          size: inspector.size,
          path: fileKey, // tells multer the file exists, so it is removed if the request is aborted
          upload: { fileKey, originalName: cleanFileName(file.originalname), mimeType: expected, sizeBytes: inspector.size, sha256: inspector.sha256 },
        }),
      )
      .catch((err) => {
        file.stream.resume(); // drain the rest of a rejected file
        cb(rejected ?? err);
      });
  }

  _removeFile(_req: Request, file: Express.Multer.File & { upload?: UploadedFile }, cb: (error: Error | null) => void) {
    if (!file.upload) return cb(null);
    this.storage.remove(file.upload.fileKey).then(() => cb(null), cb);
  }
}

function toHttpError(err: unknown, policy: UploadPolicy): HttpException {
  if (err instanceof HttpException) return err;
  if (err instanceof FileContentMismatchError) return new UnsupportedMediaTypeException(err.message);
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return new PayloadTooLargeException(`File is too large. The limit is ${formatMb(policy.maxBytes)}.`);
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return new BadRequestException('Upload one file in the "file" field');
    return new BadRequestException(`Upload rejected (${err.code})`);
  }
  return new BadRequestException('Upload failed. Please try again.');
}

const formatMb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

/**
 * Multipart upload for one file in the `file` field. Rules come from `?requirementId=` (or the
 * defaults) and are enforced inside multer before the file is kept:
 *  - extension must be an accepted type (fileFilter) — the browser's Content-Type is ignored;
 *  - size limit from the requirement (multer `limits`), capped by UPLOAD_MAX_MB;
 *  - first bytes must match the extension (InspectingStorage), checked before anything is written.
 * Anything rejected or aborted is removed from storage. Not Nest's FileInterceptor because its
 * multer options are fixed when the route is declared, and these depend on the requirement.
 */
@Injectable()
export class UploadInterceptor implements NestInterceptor {
  private readonly engine: InspectingStorage;

  constructor(private readonly files: FilesService, storage: StorageService) {
    this.engine = new InspectingStorage(storage);
  }

  async intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<UploadRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const requirementId = typeof req.query.requirementId === 'string' ? req.query.requirementId : undefined;
    if (requirementId && !/^[0-9a-f-]{36}$/i.test(requirementId)) throw new BadRequestException('requirementId must be a UUID');
    const policy = await this.files.policyFor(requirementId);

    const upload = multer({
      storage: this.engine,
      limits: { fileSize: policy.maxBytes, files: 1, fields: 5, fieldSize: 1024, parts: 6 },
      fileFilter: (_req, file, cb) => {
        const type = fileTypeFromName(file.originalname);
        if (type && policy.acceptedTypes.includes(type)) return cb(null, true);
        cb(new UnsupportedMediaTypeException(`Only ${describeFileTypes(policy.acceptedTypes)} files are allowed`));
      },
    }).single('file');

    await new Promise<void>((resolve, reject) => upload(req, res, (err?: unknown) => (err ? reject(toHttpError(err, policy)) : resolve())));
    const stored = (req.file as (Express.Multer.File & { upload?: UploadedFile }) | undefined)?.upload;
    if (!stored) throw new BadRequestException('Choose a file to upload');
    req.upload = { file: stored, policy };
    return next.handle();
  }
}
