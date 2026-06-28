-- AlterTable: cluster events + RSVP check-in
ALTER TABLE "Event" ADD COLUMN     "clusterId" TEXT;
ALTER TABLE "EventRSVP" ADD COLUMN     "checkedInAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Event_clusterId_idx" ON "Event"("clusterId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
