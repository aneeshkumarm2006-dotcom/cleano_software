-- The instant fee taken with a withdrawal, stored beside the net `amount`, so
-- the balance can reserve net + fee. Additive: existing rows get 0.
ALTER TABLE "Withdrawal" ADD COLUMN "feeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
