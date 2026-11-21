# Architecture

The pnpm workspace contains a Next.js 15 browser app, a Fastify API, and strict TypeScript shared contracts, fee math and vault helpers. The API persists records directly in Postgres with parameterized SQL and ordered, idempotent SQL migrations. The browser uses TanStack Query with polling and react-hook-form with Zod validation on the listing form.

Wallet Standard authorizes connections and message signing. Unlock and API sign-in use distinct messages. HKDF-SHA256 derives the vault seed from the unlock signature, and the seed stays in session storage and browser memory. A separate HKDF purpose derives the OTC encryption key. The API verifies a wallet signature over a five-minute, origin-bound, single-use challenge and issues a ten-minute JWT.

Listings carry a seller-only X25519/XSalsa20-Poly1305 envelope, plus explicitly public metadata. Buyers seal offers to the listing encryption key. On acceptance, the seller decrypts listing and offer terms, then encrypts a copy for each participant. Postgres locks the listing row during acceptance and enforces one accepted offer per listing. Authenticated parties retrieve only their own accepted envelope. Acceptance records a negotiation, and expiry is computed from the listing timestamp.

The SDK reads and decrypts Default Ring data in the browser. The vault constructs a proofless deposit with the SDK and requires a Wallet Standard signer that advertises transaction version 1. Explicitly enabled devnet test deposits also require an API network match.

The API has no spend authority. Fund and seal routes screen the calling wallet and fail closed. A production settlement adapter would need to verify the exact program invocation, deal binding, all paid outputs, expiry and chain finality before updating state.
