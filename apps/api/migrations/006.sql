CREATE TABLE IF NOT EXISTS otc_beta_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  trade_count integer NOT NULL DEFAULT 0 CHECK (trade_count BETWEEN 0 AND 10),
  usdc_total bigint NOT NULL DEFAULT 0 CHECK (usdc_total BETWEEN 0 AND 10000000),
  sol_total bigint NOT NULL DEFAULT 0 CHECK (sol_total BETWEEN 0 AND 100000000)
);
INSERT INTO otc_beta_budget (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS otc_beta_admission (
  offer_id uuid PRIMARY KEY REFERENCES settlement_dvp(offer_id)
);
