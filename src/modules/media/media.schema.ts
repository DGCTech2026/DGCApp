import { z } from 'zod';

// The server decides the destination folder from `type` — the client can't pick arbitrary
// folders/transformations (those would be signed by the server or rejected by Cloudinary).
export const uploadSignatureSchema = z.object({
  type: z.enum(['avatar', 'media', 'certificate', 'chat']).default('avatar'),
});

export type UploadType = z.infer<typeof uploadSignatureSchema>['type'];
