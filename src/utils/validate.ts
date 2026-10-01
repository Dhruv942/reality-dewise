import type { ZodType, z } from 'zod';
import { ValidationError } from './errors';

/** Postgres text cannot contain NUL; reject it up front instead of failing later with a 500. */
function containsNul(v: unknown): boolean {
  if (typeof v === 'string') return v.includes('\u0000');
  if (Array.isArray(v)) return v.some(containsNul);
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => k.includes('\u0000') || containsNul(x));
  return false;
}

/** Parses `data` or throws a ValidationError listing every failing field. */
export function parse<S extends ZodType>(schema: S, data: unknown): z.infer<S> {
  if (containsNul(data)) throw new ValidationError([{ field: '', message: 'Null characters are not allowed' }]);
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  }
  return result.data;
}
