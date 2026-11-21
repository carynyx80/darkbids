# Privacy and retention

The API disables Fastify request logging and does not log ciphertext, request headers, addresses or bearer tokens. IP limits use one-minute process-local windows. Wallet counters are cleared each minute and the OFAC feed snapshot lives in process for up to 15 minutes. Wallets are compared locally against the feed, with no wallet lookup sent to OFAC.

Nonce records expire after five minutes. The next nonce request removes stale rows. Listings and offers remain in Postgres after expiration or cancellation pending a retention and deletion policy. Public wallet and listing metadata are stored alongside encrypted terms. Database snapshots and hosting infrastructure logs have separate provider retention settings and were not configured here.

The browser stores the vault seed in session storage and clears it on lock, account change and page hide. Page termination behavior depends on the browser. JavaScript memory cleanup is best-effort. Viewing and signing keys are constructed in memory. RPC and indexer providers see request metadata, public deposits and encrypted-state queries. A configured public Helius endpoint is exposed in the browser bundle.
