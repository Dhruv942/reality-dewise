import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const offsetOf = (p: Pagination) => (p.page - 1) * p.limit;

export interface Page<T> { data: T[]; meta: { page: number; limit: number; total: number } }

/** Rows must carry a `totalCount` column (count(*) OVER ()). */
export function toPage<T extends { totalCount?: number }>(rows: T[], p: Pagination): Page<Omit<T, 'totalCount'>> {
  const total = rows[0]?.totalCount ?? 0;
  return { data: rows.map(({ totalCount, ...rest }) => rest), meta: { page: p.page, limit: p.limit, total } };
}
