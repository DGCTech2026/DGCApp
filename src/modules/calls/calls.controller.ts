import type { Request, Response } from 'express';
import { BadRequest } from '../../utils/errors';
import { callService } from './calls.service';
import { listCallsSchema } from './calls.schema';

export const callsController = {
  async initiate(req: Request, res: Response) {
    res.status(201).json(
      await callService.initiate(req.user!.sub, req.params.channelId as string, req.body),
    );
  },

  async listForDm(req: Request, res: Response) {
    const parsed = listCallsSchema.safeParse(req.query);
    if (!parsed.success) throw BadRequest(parsed.error.issues.map((i) => i.message).join(', '));
    res.json(await callService.listForDm(req.user!.sub, req.user!.role, req.params.channelId as string, parsed.data));
  },

  async answer(req: Request, res: Response) {
    res.json(await callService.answer(req.user!.sub, req.params.callId as string));
  },

  async decline(req: Request, res: Response) {
    res.json(await callService.decline(req.user!.sub, req.params.callId as string));
  },

  async end(req: Request, res: Response) {
    res.json(await callService.end(req.user!.sub, req.params.callId as string));
  },

  async token(req: Request, res: Response) {
    res.json(await callService.token(req.user!.sub, req.params.callId as string));
  },
};
