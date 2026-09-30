import type { ZodType, z } from 'zod';
import { ValidationError } from './errors';

/** Parses `data` or throws a ValidationError listing every failing field. */
export function parse<S extends ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  return result.data;
}
