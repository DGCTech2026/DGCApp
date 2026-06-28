import type { Request, Response } from 'express';
import { growthService } from './growth.service';

export const growthController = {
  async getMine(req: Request, res: Response) {
    res.json(await growthService.getMySummary(req.user!.sub));
  },
  async selfAttest(req: Request, res: Response) {
    res.json(await growthService.selfAttest(req.user!.sub, req.params.key as string));
  },
  async submitCertificate(req: Request, res: Response) {
    res.status(201).json(await growthService.submitCertificate(req.user!.sub, req.body));
  },
  async listMyCertificates(req: Request, res: Response) {
    res.json(await growthService.listMyCertificates(req.user!.sub));
  },
  async listPendingCertificates(_req: Request, res: Response) {
    res.json(await growthService.listPendingCertificates());
  },
  async verifyCertificate(req: Request, res: Response) {
    res.json(await growthService.verifyCertificate(req.user!.sub, req.params.id as string));
  },
  async rejectCertificate(req: Request, res: Response) {
    res.json(await growthService.rejectCertificate(req.user!.sub, req.params.id as string, req.body.reason));
  },
  async adminVerifyRequirement(req: Request, res: Response) {
    res.json(await growthService.adminVerifyRequirement(req.user!.sub, req.body.userId, req.body.requirementKey));
  },
};
