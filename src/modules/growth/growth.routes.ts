import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../utils/asyncHandler';
import { growthController } from './growth.controller';

export const growthRouter = Router();

growthRouter.get('/me', authenticate, asyncHandler(growthController.getMine));
