import { z } from 'zod';

export const submitCertificateSchema = z.object({
  requirementKey: z.string().min(1),
  title: z.string().min(1).max(200),
  fileUrl: z.string().url(),
});

// URL_UPLOAD requirements accept just a Cloudinary URL — no title, no admin review.
export const uploadRequirementProofSchema = z.object({
  fileUrl: z.string().url(),
});

export const rejectCertificateSchema = z.object({ reason: z.string().max(500).optional() });

export const adminVerifyRequirementSchema = z.object({
  userId: z.string().min(1),
  requirementKey: z.string().min(1),
});
