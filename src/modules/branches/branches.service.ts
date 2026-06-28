import { prisma } from '../../infra/db';
import { NotFound } from '../../utils/errors';

const BRANCH_SELECT = { id: true, name: true, city: true, country: true } as const;

export const branchService = {
  list() {
    return prisma.branch.findMany({ orderBy: { name: 'asc' }, select: BRANCH_SELECT });
  },

  async get(id: string) {
    const branch = await prisma.branch.findUnique({ where: { id }, select: BRANCH_SELECT });
    if (!branch) throw NotFound('Branch not found');
    return branch;
  },
};
