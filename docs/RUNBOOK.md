# Runbook

## Local operation

Use the [README](../README.md) to configure and launch. `docker compose down` stops Postgres without deleting its volume. `zolana dev start --stop` stops the CLI-managed local stack. The web status page checks API availability and network alignment. Vault reads expose SDK errors in the dashboard, and the browser retries HTTP 429 with bounded backoff.

Test deposits and spends are off by default. Enable them only in an isolated environment with disposable assets, matching API and frontend networks, and a confirmed recovery plan. The key and address are derived from the specific origin and wallet. Verify version 1 support in the wallet before testing a deposit.

## Deploy a devnet preview

Configure a hosted Postgres service and Railway API service named `veil-api`. Use repository root as the build context, set Railway's config file to `apps/api/railway.json`, and set `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`. Set the API environment using the template. Set `WEB_ORIGIN` to the exact intended Vercel preview domain before testing sign-in.

```sh
railway login
railway link
railway up --service veil-api
railway domain --service veil-api
```

Link a Vercel project with root directory `apps/web` and source access outside that root enabled. Set Node 24, the public Railway API origin, `NEXT_PUBLIC_NETWORK=devnet`, and the optional browser-safe Helius URL in the Vercel preview environment. Keep test deposits off by default. Run from the monorepo root.

```sh
vercel login
vercel link --repo
vercel deploy
```

Verify the API's `/health`, board initial load, wallet nonce exchange, offer creation, and expiry on the deployed preview. Set network and origin configuration consistently on both deployments.

## Mainnet gate

The API requires both `NEXT_PUBLIC_NETWORK=mainnet` and `ENABLE_MAINNET=true` before evaluating a mainnet launch. This build rejects mainnet startup even with those settings. Removing that final gate depends on browser-only proving, tested atomic settlement and expiry refunds, transaction and screening end-to-end tests, reviewed legal text, and production infrastructure configuration.

## Verification recorded for this build

The lockfile installed successfully and lint, strict type checking, seven unit tests and a Next.js production build passed locally. All 11 requested web and legal routes returned HTTP 200 on the built server. A disposable PostgreSQL instance passed `pnpm test:api` smoke checks for nonce replay rejection, private-route access control, encrypted negotiation, screening denial with an injected feed fixture, wallet rate limiting and fail-closed funding and sealing. The current public OFAC feed was separately downloaded and parsed successfully. The opt-in `pnpm test:localnet` test also passed a SOL deposit and local decryption of the indexed balance and history against the pinned zolana validator and Photon. Funded devnet accounts, Vercel and Railway were outside these checks.

To repeat the API smoke test, set `VEIL_TEST_DATABASE_URL` to a disposable loopback Postgres database and run `pnpm test:api`. The script starts a test API on port 4319 with a synthetic screening feed and test wallets. It applies migrations and writes temporary negotiation records.

To exercise the browser vault against disposable localnet wallets, start zolana with Photon, build and serve the web app with `NEXT_PUBLIC_NETWORK=localnet`, `NEXT_PUBLIC_ENABLE_TEST_DEPOSITS=true` and `NEXT_PUBLIC_ENABLE_TEST_SPENDS=true`, then run `pnpm --filter @veil/web exec playwright test`. The browser test defaults to `http://127.0.0.1:4318`; override with `VEIL_E2E_URL`. Install the Playwright browser or set `VEIL_CHROMIUM_EXECUTABLE` to a supported Chromium executable.

The Playwright test passed on localnet with two disposable Wallet Standard fixtures in Chromium. It completed deposit, confidential send and withdrawal and recorded no network requests containing monitored key fields or reaching the prover loopback port. Production browser extension compatibility and funded devnet remain unverified.

## Hosted devnet preview

The [Vercel staging frontend](https://veil-devnet-carynyx1.vercel.app) requires Vercel access. Its configured API is the [Railway devnet service](https://veil-api-devnet.up.railway.app/health). The Railway API uses private Postgres networking, with an exact CORS origin matching the Vercel alias. Keep the alias stable because the vault is derived from the browser origin.

Hosted checks passed for frontend page delivery and the configured API bundle, Postgres connectivity, CORS preflight, wallet sign-in and replay rejection, live screening, encrypted listing and offer, acceptance, buyer-side decryption and the settlement guard. The disposable listing was canceled. Hosted vault transactions remain disabled and the deployment has no devnet Helius RPC configured.
