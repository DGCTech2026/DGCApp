import type { Request, Response } from 'express';
import { moderationService } from './moderation.service';
import { listReportsQuerySchema } from './moderation.schema';
import { BadRequest } from '../../utils/errors';

export const moderationController = {
  async reportMessage(req: Request, res: Response) {
    res.status(201).json(
      await moderationService.reportMessage(req.user!.sub, req.params.messageId as string, req.body),
    );
  },

  async reportUser(req: Request, res: Response) {
    res.status(201).json(
      await moderationService.reportUser(req.user!.sub, req.params.userId as string, req.body),
    );
  },

  async blockUser(req: Request, res: Response) {
    res.json(await moderationService.blockUser(req.user!.sub, req.params.userId as string));
  },

  async unblockUser(req: Request, res: Response) {
    res.json(await moderationService.unblockUser(req.user!.sub, req.params.userId as string));
  },

  async listBlocked(req: Request, res: Response) {
    res.json(await moderationService.listBlocked(req.user!.sub));
  },

  async listReports(req: Request, res: Response) {
    const parsed = listReportsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw BadRequest(parsed.error.issues.map((i) => i.message).join(', '));
    res.json(await moderationService.listReports(parsed.data.status));
  },

  async resolveReport(req: Request, res: Response) {
    const status = req.body.status as 'RESOLVED' | 'DISMISSED';
    res.json(await moderationService.resolveReport(req.params.reportId as string, req.user!.sub, status));
  },
};
