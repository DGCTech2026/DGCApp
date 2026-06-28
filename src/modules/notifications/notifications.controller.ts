import type { Request, Response } from 'express';
import { notificationService } from './notifications.service';

export const notificationController = {
  async list(req: Request, res: Response) {
    res.json(await notificationService.listMine(req.user!.sub));
  },
  async markRead(req: Request, res: Response) {
    res.json(await notificationService.markRead(req.user!.sub, req.params.id as string));
  },
  async markAllRead(req: Request, res: Response) {
    res.json(await notificationService.markAllRead(req.user!.sub));
  },
};
