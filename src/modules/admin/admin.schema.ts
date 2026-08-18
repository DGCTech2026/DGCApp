import { z } from 'zod';

export const createBranchSchema = z.object({
  name: z.string().min(1).max(120),
  city: z.string().min(1).max(120),
  country: z.string().max(120).optional(),
});
export const setRoleSchema = z.object({ role: z.enum(['MEMBER', 'SUPER_ADMIN']) });
export const assignUserSchema = z.object({ userId: z.string().min(1) });

export const createClusterSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case'),
  description: z.string().min(1).max(500),
});
export const updateClusterSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(500).optional(),
}).strict();

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type CreateClusterInput = z.infer<typeof createClusterSchema>;
export type UpdateClusterInput = z.infer<typeof updateClusterSchema>;
