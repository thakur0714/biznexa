import type { LoggerService } from '@nestjs/common';
import { redact } from './redacting-logger';

/** JSON logs contain only the supplied message and context, after the existing PII scrubber runs. */
export class StructuredJsonLogger implements LoggerService {
  log(message: unknown, ...optional: unknown[]) { this.write('info', message, optional); }
  error(message: unknown, ...optional: unknown[]) { this.write('error', message, optional); }
  warn(message: unknown, ...optional: unknown[]) { this.write('warn', message, optional); }
  debug(message: unknown, ...optional: unknown[]) { this.write('debug', message, optional); }
  verbose(message: unknown, ...optional: unknown[]) { this.write('verbose', message, optional); }
  fatal(message: unknown, ...optional: unknown[]) { this.write('fatal', message, optional); }

  private write(level: string, message: unknown, optional: unknown[]) {
    const context = optional.find((value) => typeof value === 'string');
    process.stdout.write(`${JSON.stringify(redact({ timestamp: new Date().toISOString(), level, message, ...(context ? { context } : {}) }))}\n`);
  }
}
