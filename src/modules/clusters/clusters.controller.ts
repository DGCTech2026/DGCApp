import type { Request, Response } from 'express';
import { clusterService } from './clusters.service';

export const clusterController = {
  async list(req: Request, res: Response) {
    res.json(await clusterService.list(req.user!.sub));
  },
  async join(req: Request, res: Response) {
    res.json(await clusterService.join(req.user!.sub, req.params.clusterId as string));
  },
  async leave(req: Request, res: Response) {
    res.json(await clusterService.leave(req.user!.sub, req.params.clusterId as string));
  },
};
