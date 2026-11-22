CREATE TABLE IF NOT EXISTS settlement_dvp (
  offer_id uuid PRIMARY KEY REFERENCES offer(id),
  terms jsonb NOT NULL,
  asset_decimals integer NOT NULL,
  quote_decimals integer NOT NULL,
  treasury text NOT NULL
);
CREATE TABLE IF NOT EXISTS settlement_transaction (
  id uuid PRIMARY KEY,
  offer_id uuid NOT NULL REFERENCES settlement_dvp(offer_id),
  wallet text NOT NULL,
  action text NOT NULL,
  wire text NOT NULL,
  last_valid_block_height bigint NOT NULL,
  signature text
);
CREATE INDEX IF NOT EXISTS settlement_transaction_party
  ON settlement_transaction (offer_id, wallet, action);
