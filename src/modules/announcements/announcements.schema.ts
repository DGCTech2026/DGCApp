import { z } from 'zod';

export const MAX_ANNOUNCEMENT_ATTACHMENTS = 10;

const attachmentSchema = z.object({
  url: z.string().url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

// An announcement may carry media: the client uploads each file to Cloudinary first
// (POST /media/signature { type: 'media' }) and sends the resulting secure_url(s) here.
// `attachments` is the album form (ordered, up to 10); `mediaUrl` is the original single-file form
// and is kept so existing clients keep working. Send one or the other, not both.
export const postAnnouncementSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().max(4000).optional(),
    mediaUrl: z.string().url().optional(),
    attachments: z.array(attachmentSchema).min(1).max(MAX_ANNOUNCEMENT_ATTACHMENTS).optional(),
  })
  .refine((v) => !(v.mediaUrl && v.attachments), {
    message: 'Send either mediaUrl or attachments, not both',
    path: ['attachments'],
  })
  .refine((v) => (v.body?.trim().length ?? 0) > 0 || !!v.mediaUrl || !!v.attachments, {
    message: 'An announcement needs a body, a mediaUrl, or attachments',
    path: ['body'],
  });

export const announcementAdminSchema = z.object({ userId: z.string().min(1) });

export type PostAnnouncementInput = z.infer<typeof postAnnouncementSchema>;
