import { CallHandler, ExecutionContext, Injectable, NestInterceptor, HttpException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { catchError, throwError } from 'rxjs';

/** Report unexpected API failures; expected 4xx responses are not error events. beforeSend scrubs the payload. */
@Injectable()
export class SentryExceptionInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(catchError((error: unknown) => {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) Sentry.captureException(error);
      return throwError(() => error);
    }));
  }
}
