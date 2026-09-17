import { z } from 'zod';

export const reportMessageSchema = z
  .object({
    reason: z.string().min(1).max(500),
    details: z.string().max(2000).optional(),
  })
  .strict();

export const reportUserSchema = z
  .object({
    reason: z.string().min(1).max(500),
    details: z.string().max(2000).optional(),
  })
  .strict();

export const resolveReportSchema = z
  .object({
    status: z.enum(['RESOLVED', 'DISMISSED']),
  })
  .strict();

export const listReportsQuerySchema = z.object({
  status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED']).optional(),
});

export type ReportMessageInput = z.infer<typeof reportMessageSchema>;
export type ReportUserInput = z.infer<typeof reportUserSchema>;
