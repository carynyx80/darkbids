CREATE TABLE IF NOT EXISTS auth_nonce (
  nonce uuid PRIMARY KEY, wallet text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS listing (
  id uuid PRIMARY KEY, seller text NOT NULL, mint text, category text NOT NULL,
  bucket text NOT NULL, quote text NOT NULL, expires_at timestamptz NOT NULL,
  encryption_key text NOT NULL, ciphertext text NOT NULL,
  cancelled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_active ON listing (created_at DESC, id DESC) WHERE NOT cancelled;
CREATE TABLE IF NOT EXISTS offer (
  id uuid PRIMARY KEY, listing_id uuid NOT NULL REFERENCES listing(id),
  buyer text NOT NULL, encryption_key text NOT NULL, ciphertext text NOT NULL,
  accepted_at timestamptz, UNIQUE (listing_id, buyer)
);
CREATE UNIQUE INDEX IF NOT EXISTS listing_accepted_offer ON offer (listing_id) WHERE accepted_at IS NOT NULL;
