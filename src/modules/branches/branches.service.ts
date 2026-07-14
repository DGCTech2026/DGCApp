import { prisma } from '../../infra/db';
import { NotFound } from '../../utils/errors';
import { cached, cacheKeys } from '../../infra/cache';

const BRANCH_SELECT = { id: true, name: true, city: true, country: true } as const;

export const branchService = {
  // Branch catalogue barely changes — 5 min cache, invalidated when an admin creates a branch.
  list() {
    return cached(cacheKeys.branches, 300, () =>
      prisma.branch.findMany({ orderBy: { name: 'asc' }, select: BRANCH_SELECT }),
    );
  },

  async get(id: string) {
    return cached(cacheKeys.branch(id), 300, async () => {
      const branch = await prisma.branch.findUnique({ where: { id }, select: BRANCH_SELECT });
      if (!branch) throw NotFound('Branch not found');
      return branch;
    });
  },
};
