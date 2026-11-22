CREATE TABLE IF NOT EXISTS otc_liquidity_page (
  slug text PRIMARY KEY,
  owner text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  mint text NOT NULL,
  quote text NOT NULL CHECK (quote IN ('SOL','USDC')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otc_liquidity_owner ON otc_liquidity_page (owner,created_at DESC);
CREATE TABLE IF NOT EXISTS otc_liquidity_dealer (
  slug text NOT NULL REFERENCES otc_liquidity_page(slug),
  wallet text NOT NULL,
  opted_in boolean NOT NULL DEFAULT false,
  PRIMARY KEY (slug,wallet)
);
ALTER TABLE otc_rfq ADD COLUMN IF NOT EXISTS liquidity_slug text REFERENCES otc_liquidity_page(slug);
