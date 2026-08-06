import { z } from 'zod';

export const sendMessageSchema = z.object({
  type: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE', 'SYSTEM', 'POLL', 'CONTACT']).default('TEXT'),
  body: z.string().max(4000).optional(),
  mediaUrl: z.string().url().optional(),
  replyToId: z.string().optional(),
  mentions: z.array(z.string()).optional(), // user ids to @mention (notified if they're channel members)
  mentionEveryone: z.boolean().optional().default(false), // @everyone — fan-out MENTION to every non-muted member of the channel

  // Contact sharing (type = CONTACT)
  contactName: z.string().min(1).max(200).optional(),
  contactPhone: z.string().max(30).optional(),
  contactEmail: z.string().email().optional(),

  // Poll (type = POLL)
  poll: z.object({
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(200)).min(2).max(10),
    allowMultiple: z.boolean().default(false),
    expiresAt: z.coerce.date().optional(),
  }).optional(),
});

export const editMessageSchema = z.object({ body: z.string().min(1).max(4000) });
export const forwardMessageSchema = z.object({ channelId: z.string().min(1) });
export const searchMessagesSchema = z.object({ q: z.string().min(1).max(100) });

export const listMessagesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });
export const pollVoteSchema = z.object({ optionId: z.string().min(1) });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;
