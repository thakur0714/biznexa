import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { FilesController } from './files.controller';
import { FileScanService } from './file-scan.service';
import { FilesService } from './files.service';
import { LocalDiskStorage, StorageService } from './storage.service';
import { UploadInterceptor } from './upload.interceptor';
import { ClamAvScanner, StubVirusScanner, VirusScanner } from './virus-scanner';

function virusScanner(): VirusScanner {
  const e = env();
  return e.VIRUS_SCANNER === 'clamav' ? new ClamAvScanner(e.CLAMAV_HOST, e.CLAMAV_PORT) : new StubVirusScanner();
}

/** Uploads, private storage, virus scanning (D23) and signed downloads (D17). Global so documents, deliverables and certificates can reuse it. */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    FileScanService,
    UploadInterceptor,
    { provide: StorageService, useFactory: () => new LocalDiskStorage(env().UPLOAD_DIR) },
    { provide: VirusScanner, useFactory: virusScanner },
  ],
  exports: [FilesService, StorageService],
})
export class FilesModule {}
