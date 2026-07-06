import { z } from 'zod';

export const postAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
});

export const announcementAdminSchema = z.object({ userId: z.string().min(1) });

export type PostAnnouncementInput = z.infer<typeof postAnnouncementSchema>;
