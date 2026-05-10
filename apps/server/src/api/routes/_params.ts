/**
 * Shared route param schemas. The single-`id` shape is used by every CRUD
 * route; compound shapes live in their own route files.
 */
import { z } from 'zod';

export const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
