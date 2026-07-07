-- Data migration: each branch "Service Updates" section becomes the read-only branch announcement
-- channel (only branch admins / super admins post; PRD §3 "create branch announcements").
UPDATE "Channel" SET "isReadOnly" = true WHERE "type" = 'BRANCH_SECTION' AND "name" = 'Service Updates';
