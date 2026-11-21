# Threat model

## Chain and upstream services

The Default Ring exposes sender and recipient addresses, timing and transaction metadata. It encrypts confidential transfer amounts and assets. Public deposits and withdrawals reveal the mint and amount at the public boundary. Size buckets, sparse liquidity and adjacent transfers can narrow a trade's likely terms. The board publishes the mint unless the seller hides it, and every listing publishes its quote asset.

Privacy also depends on Solana availability, the deployed program and its current upgrade and pause authorities, and the indexer's completeness. The 2-of-5 pause claim in the brief requires verification against the actual target deployment and is treated as unverified. The hosted prover's encrypted TEE channel protects in transit and leaves the prover workload with the witness, including economic inputs and the nullifier secret. VEIL routes enabled spend proofs to its browser worker and denies network fallback for the proof endpoint. Proving keys fetched by the worker are public and checked against the shipped pins. [Helius security](https://www.helius.dev/docs/privacy/security) · [Helius architecture](https://www.helius.dev/docs/privacy/concepts/architecture)

## Browser and desk

A database compromise exposes wallet addresses, timestamps, activity relationships, public listing fields, encryption public keys and ciphertext. A live API compromise can also forge desk sessions, alter negotiation metadata or substitute delivered recipient keys unless clients verify keys independently. Accepted envelopes currently bind terms by authenticated encryption to a recipient key. They do not constitute an independently signed agreement or chain authorization.

Browser origin compromise, phishing, malicious extensions or injected JavaScript can expose the derivation seed and decrypted terms. The wallet unlock signature is a vault credential. The client constructs both unlock and sign-in messages locally to prevent a server-supplied unlock request masquerading as authentication. Protect the origin, isolate production and preview origins, and pin the production deploy process. A domain change changes the derived vault, and wallet extensions must return a deterministic signature over the same unlock message for recovery.

## Screening and limits

The API screens exact Solana address identifiers in OFAC's SDN feed. Its coverage is limited to published identifiers. The adapter fails closed on unavailability or malformed or incomplete feed shape. Rate limiting is process-local. Reverse proxy client-IP attribution and multi-instance limits require infrastructure validation. Vercel geo-blocking protects the web surface, while direct API requests still need an edge policy before production exposure.
