import { z } from 'zod';

const e164 = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 format, e.g. +2348012345678');

// Profile completion (PRD §1 "Create Account" form). Selecting `branchId` the first time triggers
// onboarding (auto-join branch community + Global Announcement). `email`/`phoneNumber` let a user
// add the contact they did NOT sign up with (e.g. email-OTP user adds their phone). `.strict()`
// blocks privilege fields like globalRole from being self-set.
export const updateMeSchema = z
  .object({
    displayName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    phoneNumber: e164.optional(),
    password: z.string().min(8).max(128).optional(), // set during Step 1 registration, in one call
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    dateOfBirth: z.coerce.date().optional(),
    occupation: z.string().max(120).optional(),
    avatarUrl: z.string().url().optional(),
    bio: z.string().max(500).optional(),
    branchId: z.string().min(1).optional(),
  })
  .strict();

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
