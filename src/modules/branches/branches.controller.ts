import type { Request, Response } from 'express';
import { branchService } from './branches.service';

export const branchController = {
  async list(_req: Request, res: Response) {
    res.json(await branchService.list());
  },

  async get(req: Request, res: Response) {
    res.json(await branchService.get(req.params.id as string));
  },
};
