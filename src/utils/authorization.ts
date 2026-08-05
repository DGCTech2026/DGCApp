import { prisma } from '../infra/db';

// Scoped-admin lookups shared across features (audio rooms, announcements, events, …).
// Global SUPER_ADMIN is a JWT claim checked inline at each call site — no DB round-trip.
// These do a single indexed lookup via the composite unique key on the membership table.

export async function isBranchAdmin(userId: string, branchId: string): Promise<boolean> {
  const bm = await prisma.branchMembership.findUnique({
    where: { userId_branchId: { userId, branchId } },
    select: { role: true },
  });
  return bm?.role === 'ADMIN';
}

export async function isClusterModerator(userId: string, clusterId: string): Promise<boolean> {
  const cm = await prisma.clusterMembership.findUnique({
    where: { userId_clusterId: { userId, clusterId } },
    select: { role: true },
  });
  return cm?.role === 'MODERATOR';
}

// Can this user create a scoped resource (audio room, cluster event, …) tied to the given
// branch/cluster? Unscoped resources (both null) require SUPER_ADMIN.
export async function canCreateForScope(
  userId: string,
  role: string,
  scope: { branchId: string | null; clusterId: string | null },
): Promise<boolean> {
  if (role === 'SUPER_ADMIN') return true;
  if (scope.branchId && (await isBranchAdmin(userId, scope.branchId))) return true;
  if (scope.clusterId && (await isClusterModerator(userId, scope.clusterId))) return true;
  return false;
}

// Can this user moderate an existing resource — the room host / event creator always can,
// plus super admin, plus the branch admin of the resource's branch / cluster moderator of its cluster.
export async function canModerateScoped(
  userId: string,
  role: string,
  resource: { ownerId: string | null; branchId: string | null; clusterId: string | null },
): Promise<boolean> {
  if (role === 'SUPER_ADMIN') return true;
  if (resource.ownerId && resource.ownerId === userId) return true;
  if (resource.branchId && (await isBranchAdmin(userId, resource.branchId))) return true;
  if (resource.clusterId && (await isClusterModerator(userId, resource.clusterId))) return true;
  return false;
}
