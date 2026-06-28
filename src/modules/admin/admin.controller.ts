import type { Request, Response } from 'express';
import { adminService } from './admin.service';

export const adminController = {
  async analytics(_req: Request, res: Response) {
    res.json(await adminService.analytics());
  },
  async listUsers(req: Request, res: Response) {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json(await adminService.listUsers(search));
  },
  async suspend(req: Request, res: Response) {
    res.json(await adminService.setSuspended(req.params.userId as string, true));
  },
  async unsuspend(req: Request, res: Response) {
    res.json(await adminService.setSuspended(req.params.userId as string, false));
  },
  async setRole(req: Request, res: Response) {
    res.json(await adminService.setRole(req.params.userId as string, req.body.role));
  },
  async createBranch(req: Request, res: Response) {
    res.status(201).json(await adminService.createBranch(req.body));
  },
  async assignBranchAdmin(req: Request, res: Response) {
    res.json(await adminService.assignBranchAdmin(req.params.branchId as string, req.body.userId));
  },
  async archiveCluster(req: Request, res: Response) {
    res.json(await adminService.setClusterArchived(req.params.clusterId as string, true));
  },
  async unarchiveCluster(req: Request, res: Response) {
    res.json(await adminService.setClusterArchived(req.params.clusterId as string, false));
  },
};
