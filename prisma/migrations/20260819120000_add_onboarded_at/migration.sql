-- Add onboardedAt timestamp to User; backfill existing onboarded users.
ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);

-- Every user who already has a displayName AND at least one branch membership is onboarded.
UPDATE "User" u
SET "onboardedAt" = u."createdAt"
WHERE u."displayName" IS NOT NULL
  AND u."deletedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "BranchMembership" bm WHERE bm."userId" = u."id");
