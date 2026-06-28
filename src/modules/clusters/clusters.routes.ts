import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../utils/asyncHandler';
import { clusterController } from './clusters.controller';

export const clustersRouter = Router();

clustersRouter.get('/', authenticate, asyncHandler(clusterController.list));
clustersRouter.post('/:clusterId/join', authenticate, asyncHandler(clusterController.join));
clustersRouter.post('/:clusterId/leave', authenticate, asyncHandler(clusterController.leave));
