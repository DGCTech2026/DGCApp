import { z } from 'zod';

export const createEventSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    location: z.string().max(300).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().optional(),
    branchId: z.string().optional(), // branch event
    clusterId: z.string().optional(), // cluster event; neither = global
  })
  .strict();

export const rsvpSchema = z.object({ status: z.enum(['GOING', 'INTERESTED', 'NOT_GOING']) });

export type CreateEventInput = z.infer<typeof createEventSchema>;
