import type { Request, Response } from 'express';
import { eventService } from './events.service';

export const eventController = {
  async list(req: Request, res: Response) {
    res.json(await eventService.listUpcoming(req.user!.sub));
  },
  async get(req: Request, res: Response) {
    res.json(await eventService.get(req.user!.sub, req.params.eventId as string));
  },
  async create(req: Request, res: Response) {
    res.status(201).json(await eventService.create(req.user!.sub, req.user!.role, req.body));
  },
  async rsvp(req: Request, res: Response) {
    res.json(await eventService.rsvp(req.user!.sub, req.params.eventId as string, req.body.status));
  },
  async checkIn(req: Request, res: Response) {
    res.json(await eventService.checkIn(req.user!.sub, req.params.eventId as string));
  },
};
