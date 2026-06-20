-- BNB Hackathon migration: BSC tx hash + natural language strategy mandate

ALTER TABLE users ADD COLUMN IF NOT EXISTS cfo_strategy TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cfo_wallet_address TEXT;

ALTER TABLE cfo_decisions ADD COLUMN IF NOT EXISTS bsc_tx_hash TEXT;
