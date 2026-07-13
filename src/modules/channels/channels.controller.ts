import type { Request, Response } from 'express';
import { channelService } from './channels.service';

export const channelController = {
  async listMine(req: Request, res: Response) {
    res.json(await channelService.listMine(req.user!.sub));
  },
  async get(req: Request, res: Response) {
    res.json(await channelService.get(req.user!.sub, req.user!.role, req.params.channelId as string));
  },
  async markRead(req: Request, res: Response) {
    res.json(await channelService.markRead(req.user!.sub, req.user!.role, req.params.channelId as string));
  },
  async openDm(req: Request, res: Response) {
    res.status(201).json(await channelService.openDm(req.user!.sub, req.body.userId));
  },
  async members(req: Request, res: Response) {
    res.json(await channelService.members(req.user!.sub, req.user!.role, req.params.channelId as string));
  },
  async mute(req: Request, res: Response) {
    res.json(await channelService.mute(req.user!.sub, req.params.channelId as string));
  },
  async unmute(req: Request, res: Response) {
    res.json(await channelService.unmute(req.user!.sub, req.params.channelId as string));
  },
  async pinnedMessages(req: Request, res: Response) {
    res.json(await channelService.pinnedMessages(req.user!.sub, req.user!.role, req.params.channelId as string));
  },
  async sharedMedia(req: Request, res: Response) {
    const cursor = req.query.cursor as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await channelService.sharedMedia(req.user!.sub, req.user!.role, req.params.channelId as string, cursor, limit));
  },
};
