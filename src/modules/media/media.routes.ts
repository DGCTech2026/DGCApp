import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { uploadSignatureSchema } from './media.schema';
import { mediaController } from './media.controller';

export const mediaRouter = Router();

// Returns Cloudinary signed-upload params. Client uploads directly to Cloudinary, then sends the
// resulting secure_url back (e.g. PATCH /users/me { avatarUrl } for a profile picture).
mediaRouter.post(
  '/signature',
  authenticate,
  validate(uploadSignatureSchema),
  asyncHandler(mediaController.createUploadSignature),
);
