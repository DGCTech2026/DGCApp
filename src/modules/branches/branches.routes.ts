import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { branchController } from './branches.controller';

// Public read endpoints — power the registration branch picker.
// Branch create/update + admin assignment land in the dedicated branches slice.
export const branchesRouter = Router();

branchesRouter.get('/', asyncHandler(branchController.list));
branchesRouter.get('/:id', asyncHandler(branchController.get));
