import { z } from 'zod';

export const sendMessageSchema = z.object({
  type: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'SYSTEM']).default('TEXT'),
  body: z.string().max(4000).optional(),
  mediaUrl: z.string().url().optional(),
  replyToId: z.string().optional(),
});

export const listMessagesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
