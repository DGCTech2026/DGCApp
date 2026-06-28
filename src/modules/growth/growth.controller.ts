import type { Request, Response } from 'express';
import { growthService } from './growth.service';

export const growthController = {
  async getMine(req: Request, res: Response) {
    res.json(await growthService.getMySummary(req.user!.sub));
  },
};
