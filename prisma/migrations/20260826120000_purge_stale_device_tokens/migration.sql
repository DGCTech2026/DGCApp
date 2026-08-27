-- Purge all device tokens. 35 of 54 tokens fail with "SenderId mismatch" —
-- registered under a previous Firebase project. Users re-register on next app open.
TRUNCATE TABLE "DeviceToken";
