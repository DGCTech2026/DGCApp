import { z } from 'zod';

export const initiateCallSchema = z.object({
  type: z.enum(['AUDIO', 'VIDEO']).default('AUDIO'),
});

export const listCallsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type InitiateCallInput = z.infer<typeof initiateCallSchema>;
export type ListCallsInput = z.infer<typeof listCallsSchema>;
