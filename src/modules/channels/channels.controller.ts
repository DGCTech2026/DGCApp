import type { Request, Response } from 'express';
import { channelService } from './channels.service';

export const channelController = {
  async listMine(req: Request, res: Response) {
    res.json(await channelService.listMine(req.user!.sub));
  },
  async get(req: Request, res: Response) {
    res.json(await channelService.get(req.user!.sub, req.user!.role, req.params.channelId as string));
  },
  async markRead(req: Request, res: Response) {
    res.json(await channelService.markRead(req.user!.sub, req.user!.role, req.params.channelId as string));
  },
  async openDm(req: Request, res: Response) {
    res.status(201).json(await channelService.openDm(req.user!.sub, req.body.userId));
  },
};
