-- Job chat photo attachments (CLN-P0-3-05).
--
-- Three nullable columns on JobChatMessage. NULL = text-only message, which is
-- every row that exists today, so behaviour is byte-for-byte unchanged until a
-- photo is actually sent.
--
-- `body` is deliberately left NOT NULL: a photo-only message stores the empty
-- string. JobChatThread already renders `{m.body && <div>{m.body}</div>}`, so
-- an empty body has always been safe, and widening the column to nullable would
-- flip the generated Prisma type to `string | null` across every reader for no
-- behavioural gain.
--
-- Width/height are stored because Cloudinary returns them on upload and the
-- thread polls every 4s and auto-scrolls to the newest message — without a
-- reserved box the view jumps as each image decodes.
--
-- PRE-FLIGHT (should return 0 — the columns must not already exist):
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'JobChatMessage'
--      AND column_name IN ('attachmentUrl','attachmentWidth','attachmentHeight');
--
-- POST-APPLY VERIFICATION (expect 3 rows, all is_nullable = YES):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'JobChatMessage'
--      AND column_name IN ('attachmentUrl','attachmentWidth','attachmentHeight');
--
-- ROLLBACK (no data loss — nothing is backfilled):
--   ALTER TABLE "JobChatMessage"
--     DROP COLUMN "attachmentUrl",
--     DROP COLUMN "attachmentWidth",
--     DROP COLUMN "attachmentHeight";

ALTER TABLE "JobChatMessage" ADD COLUMN "attachmentUrl" TEXT;
ALTER TABLE "JobChatMessage" ADD COLUMN "attachmentWidth" INTEGER;
ALTER TABLE "JobChatMessage" ADD COLUMN "attachmentHeight" INTEGER;
