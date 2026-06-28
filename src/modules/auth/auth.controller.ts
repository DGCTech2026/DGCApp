import type { Request, Response } from 'express';
import { authService } from './auth.service';

export const authController = {
  async requestOtp(req: Request, res: Response) {
    await authService.requestEmailOtp(req.body.email);
    res.json({ ok: true });
  },

  async verifyOtp(req: Request, res: Response) {
    const tokens = await authService.verifyOtp(req.body.email, req.body.code);
    res.json(tokens);
  },

  async requestPhoneOtp(req: Request, res: Response) {
    await authService.requestPhoneOtp(req.body.phone);
    res.json({ ok: true });
  },

  async verifyPhoneOtp(req: Request, res: Response) {
    const tokens = await authService.verifyOtp(req.body.phone, req.body.code);
    res.json(tokens);
  },

  async google(req: Request, res: Response) {
    const tokens = await authService.googleAuth(req.body.idToken);
    res.json(tokens);
  },

  async apple(req: Request, res: Response) {
    const tokens = await authService.appleAuth(req.body.idToken);
    res.json(tokens);
  },

  async refresh(req: Request, res: Response) {
    const tokens = await authService.refreshTokens(req.body.refreshToken);
    res.json(tokens);
  },

  async login(req: Request, res: Response) {
    res.json(await authService.login(req.body.email, req.body.password));
  },

  async setPassword(req: Request, res: Response) {
    res.json(await authService.setPassword(req.user!.sub, req.body.password));
  },

  async resetPassword(req: Request, res: Response) {
    res.json(await authService.resetPassword(req.body.email, req.body.code, req.body.newPassword));
  },

  async logout(req: Request, res: Response) {
    if (req.user) await authService.logout(req.user.sub, req.body.refreshToken);
    res.json({ ok: true });
  },
};
