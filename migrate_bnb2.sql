-- Per-user encrypted BSC agent wallet key
ALTER TABLE users ADD COLUMN IF NOT EXISTS cfo_wallet_key TEXT;
