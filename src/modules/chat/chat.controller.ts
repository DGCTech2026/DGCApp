import type { Request, Response } from 'express';
import { chatService } from './chat.service';
import { listMessagesSchema, searchMessagesSchema } from './chat.schema';
import { BadRequest } from '../../utils/errors';

export const chatController = {
  async send(req: Request, res: Response) {
    const msg = await chatService.send(req.user!.sub, req.user!.role, req.params.channelId as string, req.body);
    res.status(201).json(msg);
  },
  async list(req: Request, res: Response) {
    // Express 5 makes req.query read-only, so parse here rather than via the validate middleware.
    const parsed = listMessagesSchema.safeParse(req.query);
    if (!parsed.success) throw BadRequest(parsed.error.issues.map((i) => i.message).join(', '));
    res.json(await chatService.list(req.user!.sub, req.user!.role, req.params.channelId as string, parsed.data));
  },
  async addReaction(req: Request, res: Response) {
    res.json(await chatService.addReaction(req.user!.sub, req.user!.role, req.params.messageId as string, req.body.emoji));
  },
  async removeReaction(req: Request, res: Response) {
    res.json(await chatService.removeReaction(req.user!.sub, req.user!.role, req.params.messageId as string, req.body.emoji));
  },
  async pin(req: Request, res: Response) {
    res.json(await chatService.setPin(req.user!.sub, req.user!.role, req.params.messageId as string, true));
  },
  async unpin(req: Request, res: Response) {
    res.json(await chatService.setPin(req.user!.sub, req.user!.role, req.params.messageId as string, false));
  },
  async remove(req: Request, res: Response) {
    res.json(await chatService.remove(req.user!.sub, req.user!.role, req.params.messageId as string));
  },
  async edit(req: Request, res: Response) {
    res.json(await chatService.edit(req.user!.sub, req.params.messageId as string, req.body.body));
  },
  async forward(req: Request, res: Response) {
    res.status(201).json(await chatService.forward(req.user!.sub, req.user!.role, req.params.messageId as string, req.body.channelId));
  },
  async search(req: Request, res: Response) {
    const parsed = searchMessagesSchema.safeParse(req.query);
    if (!parsed.success) throw BadRequest(parsed.error.issues.map((i) => i.message).join(', '));
    res.json(await chatService.search(req.user!.sub, req.user!.role, req.params.channelId as string, parsed.data.q));
  },
  async votePoll(req: Request, res: Response) {
    res.json(await chatService.votePoll(req.user!.sub, req.user!.role, req.params.messageId as string, req.body.optionId));
  },
  async retractVote(req: Request, res: Response) {
    res.json(await chatService.retractVote(req.user!.sub, req.user!.role, req.params.messageId as string, req.body.optionId));
  },
};
