import type { Request, Response } from 'express';
import { mediaService } from './media.service';
import { mediaLimits } from './media.limits';

export const mediaController = {
  async createUploadSignature(req: Request, res: Response) {
    res.json(mediaService.createUploadSignature(req.body.type));
  },

  async limits(_req: Request, res: Response) {
    res.json(mediaLimits());
  },
};
