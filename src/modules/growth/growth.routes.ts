import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  submitCertificateSchema,
  rejectCertificateSchema,
  adminVerifyRequirementSchema,
  uploadRequirementProofSchema,
} from './growth.schema';
import { growthController } from './growth.controller';

export const growthRouter = Router();

// Member
growthRouter.get('/me', authenticate, asyncHandler(growthController.getMine));
growthRouter.post('/requirements/:key/complete', authenticate, asyncHandler(growthController.selfAttest));
growthRouter.post(
  '/requirements/:key/upload',
  authenticate,
  validate(uploadRequirementProofSchema),
  asyncHandler(growthController.uploadRequirementProof),
);
growthRouter.post('/certificates', authenticate, validate(submitCertificateSchema), asyncHandler(growthController.submitCertificate));
growthRouter.get('/certificates', authenticate, asyncHandler(growthController.listMyCertificates));

// Admin — verification queue (PRD §13)
growthRouter.get('/admin/certificates', authenticate, asyncHandler(growthController.listPendingCertificates));
growthRouter.post('/admin/certificates/:id/verify', authenticate, asyncHandler(growthController.verifyCertificate));
growthRouter.post('/admin/certificates/:id/reject', authenticate, validate(rejectCertificateSchema), asyncHandler(growthController.rejectCertificate));
growthRouter.post('/admin/requirements/verify', authenticate, validate(adminVerifyRequirementSchema), asyncHandler(growthController.adminVerifyRequirement));
