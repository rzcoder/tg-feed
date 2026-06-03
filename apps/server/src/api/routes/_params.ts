// Shared by every CRUD route; compound param shapes live in their own route files.
import { z } from 'zod';

export const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
