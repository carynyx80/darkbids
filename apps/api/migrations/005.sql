ALTER TABLE listing ADD COLUMN IF NOT EXISTS private_rfq boolean NOT NULL DEFAULT false;
ALTER TABLE settlement_transaction ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
CREATE TABLE IF NOT EXISTS otc_contact (
  wallet text PRIMARY KEY,
  encryption_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS otc_rfq (
  id uuid PRIMARY KEY,
  seller text NOT NULL,
  expires_at timestamptz NOT NULL,
  treasury text NOT NULL,
  winning_deal uuid REFERENCES offer(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS otc_rfq_invite (
  rfq_id uuid NOT NULL REFERENCES otc_rfq(id),
  dealer text NOT NULL,
  seller_key text NOT NULL,
  dealer_key text NOT NULL,
  request_copy text NOT NULL,
  seller_copy text NOT NULL,
  quote_id uuid UNIQUE,
  quote_expires_at timestamptz,
  commitment text,
  signature text,
  seller_terms text,
  dealer_terms text,
  PRIMARY KEY (rfq_id, dealer)
);
CREATE INDEX IF NOT EXISTS otc_rfq_dealer ON otc_rfq_invite (dealer, rfq_id);
CREATE INDEX IF NOT EXISTS otc_rfq_owner ON otc_rfq (seller, created_at DESC);

CREATE TABLE IF NOT EXISTS otc_treasury_policy (
  wallet text PRIMARY KEY,
  approver text NOT NULL CHECK (wallet <> approver),
  sol_threshold numeric(40,0) NOT NULL CHECK (sol_threshold >= 0),
  usdc_threshold numeric(40,0) NOT NULL CHECK (usdc_threshold >= 0)
);
CREATE TABLE IF NOT EXISTS otc_deal_policy (
  offer_id uuid NOT NULL REFERENCES offer(id),
  wallet text NOT NULL,
  approver text NOT NULL,
  sol_threshold numeric(40,0) NOT NULL,
  usdc_threshold numeric(40,0) NOT NULL,
  review_ciphertext text,
  approved_commitment text,
  approval_signature text,
  PRIMARY KEY (offer_id, wallet)
);
CREATE INDEX IF NOT EXISTS otc_treasury_inbox ON otc_deal_policy (approver) WHERE review_ciphertext IS NOT NULL;
CREATE OR REPLACE FUNCTION otc_snapshot_deal_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accepted_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.accepted_at IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO otc_deal_policy (offer_id,wallet,approver,sol_threshold,usdc_threshold)
    SELECT NEW.id,p.wallet,p.approver,p.sol_threshold,p.usdc_threshold
    FROM otc_treasury_policy p JOIN listing l ON l.id=NEW.listing_id
    WHERE p.wallet IN (l.seller, NEW.buyer);
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER otc_deal_policy_snapshot
  AFTER INSERT OR UPDATE OF accepted_at ON offer
  FOR EACH ROW EXECUTE FUNCTION otc_snapshot_deal_policy();
