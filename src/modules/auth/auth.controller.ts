import type { Request, Response } from 'express';
import { authService } from './auth.service';

export const authController = {
  async requestOtp(req: Request, res: Response) {
    await authService.requestOtp(req.body.email);
    res.json({ ok: true });
  },

  async verifyOtp(req: Request, res: Response) {
    const tokens = await authService.verifyOtp(req.body.email, req.body.code);
    res.json(tokens);
  },

  async google(req: Request, res: Response) {
    const tokens = await authService.googleAuth(req.body.idToken);
    res.json(tokens);
  },

  async refresh(req: Request, res: Response) {
    const tokens = await authService.refreshTokens(req.body.refreshToken);
    res.json(tokens);
  },

  async logout(req: Request, res: Response) {
    if (req.user) await authService.logout(req.user.sub, req.body.refreshToken);
    res.json({ ok: true });
  },
};
