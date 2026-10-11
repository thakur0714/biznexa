import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '../generated/prisma/client';

/** Turns known database errors into clean HTTP responses instead of 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Prisma');

  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    switch (err.code) {
      case 'P2002': {
        const target = (err.meta?.target as string[] | string | undefined) ?? 'value';
        return res.status(HttpStatus.CONFLICT).json({
          statusCode: 409,
          message: `This ${Array.isArray(target) ? target.join(', ') : target} is already in use`,
        });
      }
      case 'P2025':
        return res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: 'Record not found' });
      case 'P2003':
        return res.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, message: 'Related record does not exist' });
      default:
        this.logger.error(err.message);
        return res.status(500).json({ statusCode: 500, message: 'Something went wrong' });
    }
  }
}
