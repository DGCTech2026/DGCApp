-- "Remind Me" on scheduled audio rooms
CREATE TABLE "AudioRoomReminder" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioRoomReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AudioRoomReminder_roomId_userId_key" ON "AudioRoomReminder"("roomId", "userId");
CREATE INDEX "AudioRoomReminder_userId_idx" ON "AudioRoomReminder"("userId");

ALTER TABLE "AudioRoomReminder" ADD CONSTRAINT "AudioRoomReminder_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "AudioRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioRoomReminder" ADD CONSTRAINT "AudioRoomReminder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
