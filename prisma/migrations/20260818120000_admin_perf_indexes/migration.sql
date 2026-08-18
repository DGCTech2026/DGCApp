-- ClusterMembership: index on userId for the admin member list cluster lookups
CREATE INDEX "ClusterMembership_userId_idx" ON "ClusterMembership"("userId");

-- Message: index on deletedAt for the COUNT(*) WHERE deletedAt IS NULL in analytics
CREATE INDEX "Message_deletedAt_idx" ON "Message"("deletedAt");

-- BranchMembership: composite index for the monthly growth GROUP BY query
CREATE INDEX "BranchMembership_branchId_joinedAt_idx" ON "BranchMembership"("branchId", "joinedAt");
