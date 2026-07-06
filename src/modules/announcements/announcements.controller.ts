import type { Request, Response } from 'express';
import { announcementService } from './announcements.service';

export const announcementController = {
  async list(_req: Request, res: Response) {
    res.json(await announcementService.list());
  },

  async post(req: Request, res: Response) {
    res.status(201).json(await announcementService.post(req.user!.sub, req.user!.role, req.body));
  },

  async listAdmins(_req: Request, res: Response) {
    res.json(await announcementService.listAdmins());
  },

  async grantAdmin(req: Request, res: Response) {
    res.json(await announcementService.grantAdmin(req.body.userId));
  },

  async revokeAdmin(req: Request, res: Response) {
    res.json(await announcementService.revokeAdmin(req.params.userId as string));
  },
};
