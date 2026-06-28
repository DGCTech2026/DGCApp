import type { Request, Response } from 'express';
import { mediaService } from './media.service';

export const mediaController = {
  async createUploadSignature(req: Request, res: Response) {
    res.json(mediaService.createUploadSignature(req.body.type));
  },
};
