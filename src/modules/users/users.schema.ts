import { z } from 'zod';

// Profile completion (PRD §1). Selecting `branchId` for the first time triggers onboarding
// (auto-join branch community + Global Announcement). `.strict()` blocks privilege fields
// like globalRole from being self-set.
export const updateMeSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    dateOfBirth: z.coerce.date().optional(),
    occupation: z.string().max(120).optional(),
    avatarUrl: z.string().url().optional(),
    bio: z.string().max(500).optional(),
    branchId: z.string().min(1).optional(),
  })
  .strict();

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
