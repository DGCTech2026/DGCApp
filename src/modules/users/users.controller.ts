import type { Request, Response } from 'express';
import { userService } from './users.service';

export const userController = {
  async getMe(req: Request, res: Response) {
    res.json(await userService.getMe(req.user!.sub));
  },

  async updateMe(req: Request, res: Response) {
    res.json(await userService.updateMe(req.user!.sub, req.body));
  },
};
