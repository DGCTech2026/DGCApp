import { z } from 'zod';

export const createBranchSchema = z.object({
  name: z.string().min(1).max(120),
  city: z.string().min(1).max(120),
  country: z.string().max(120).optional(),
});
export const setRoleSchema = z.object({ role: z.enum(['MEMBER', 'SUPER_ADMIN']) });
export const assignUserSchema = z.object({ userId: z.string().min(1) });

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
