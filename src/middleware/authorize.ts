import type { RequestHandler } from 'express';
import { prisma } from '../infra/db';
import { Unauthorized, Forbidden } from '../utils/errors';

type Scope = 'branch' | 'cluster' | 'channel';

/**
 * Scoped RBAC guard (CLAUDE.md §6.1).
 *
 * Resolves one question: is the user SUPER_ADMIN globally? If not, what is their
 * role in THIS specific branch / cluster / channel? The required role(s) are
 * checked against the relevant membership row.
 *
 * Use AFTER `authenticate`. The scope id is read from `req.params[paramName]`,
 * defaulting to `<scope>Id` (e.g. `branchId`).
 */
export function authorize(scope: Scope, roles: string[], paramName?: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const user = req.user;
      if (!user) return next(Unauthorized());

      // Global super admin bypasses scope checks.
      if (user.role === 'SUPER_ADMIN') return next();

      const idParam = paramName ?? `${scope}Id`;
      const scopeId = req.params[idParam];
      if (typeof scopeId !== 'string' || !scopeId) return next(Forbidden(`Missing ${idParam}`));

      let role: string | undefined;
      if (scope === 'branch') {
        const m = await prisma.branchMembership.findUnique({
          where: { userId_branchId: { userId: user.sub, branchId: scopeId } },
        });
        role = m?.role;
      } else if (scope === 'cluster') {
        const m = await prisma.clusterMembership.findUnique({
          where: { userId_clusterId: { userId: user.sub, clusterId: scopeId } },
        });
        role = m?.role;
      } else {
        const m = await prisma.channelMembership.findUnique({
          where: { userId_channelId: { userId: user.sub, channelId: scopeId } },
        });
        role = m?.role;
      }

      if (!role || !roles.includes(role)) return next(Forbidden());
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Global super-admin gate for /admin endpoints. Use AFTER `authenticate`.
export const requireSuperAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(Unauthorized());
  if (req.user.role !== 'SUPER_ADMIN') return next(Forbidden('Super admin only'));
  next();
};
