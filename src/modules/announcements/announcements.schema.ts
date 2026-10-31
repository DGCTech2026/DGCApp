import { z } from 'zod';

// An announcement may carry one image/video: the client uploads it to Cloudinary first
// (POST /media/signature { type: 'media' }) and sends the resulting secure_url here.
export const postAnnouncementSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().max(4000).optional(),
    mediaUrl: z.string().url().optional(),
  })
  .refine((v) => (v.body?.trim().length ?? 0) > 0 || !!v.mediaUrl, {
    message: 'An announcement needs a body or a mediaUrl',
    path: ['body'],
  });

export const announcementAdminSchema = z.object({ userId: z.string().min(1) });

export type PostAnnouncementInput = z.infer<typeof postAnnouncementSchema>;
