import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/** Validates a body/query against a zod schema; returns field-level errors. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  // Input is `unknown`: schemas that transform (e.g. the form-data validator) have a different input type.
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Please check the highlighted fields',
        errors: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
