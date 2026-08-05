import type { Request, Response } from 'express';
import { prayerWatchService } from './prayer-watch.service';

export const prayerWatchController = {
  async getLive(_req: Request, res: Response) {
    const live = await prayerWatchService.getLive();
    res.json({ live });
  },
  async start(req: Request, res: Response) {
    res.status(201).json(await prayerWatchService.start(req.user!.sub, req.user!.role));
  },
  async end(req: Request, res: Response) {
    res.json(await prayerWatchService.end(req.user!.sub, req.user!.role, req.params.roomId as string));
  },
};
