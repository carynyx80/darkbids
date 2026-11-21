CREATE TABLE IF NOT EXISTS settlement_approval (
  offer_id uuid NOT NULL REFERENCES offer(id),
  wallet text NOT NULL,
  commitment text NOT NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, wallet)
);
