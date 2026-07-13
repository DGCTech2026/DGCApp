import type { Request, Response } from 'express';
import { userService } from './users.service';
import { pushService } from '../push/push.service';

export const userController = {
  async getMe(req: Request, res: Response) {
    res.json(await userService.getMe(req.user!.sub));
  },

  async updateMe(req: Request, res: Response) {
    res.json(await userService.updateMe(req.user!.sub, req.body));
  },

  async getProfile(req: Request, res: Response) {
    res.json(await userService.getProfile(req.user!.sub, req.params.userId as string));
  },

  async deleteMe(req: Request, res: Response) {
    res.json(await userService.deleteMe(req.user!.sub));
  },

  async registerDevice(req: Request, res: Response) {
    res.json(await pushService.registerDevice(req.user!.sub, req.body.token, req.body.platform));
  },

  async removeDevice(req: Request, res: Response) {
    res.json(await pushService.removeDevice(req.user!.sub, req.body.token));
  },
};
