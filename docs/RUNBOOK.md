# Runbook

## Local operation

Use the [README](../README.md) to configure and launch. `docker compose down` stops Postgres without deleting its volume. `zolana dev stop` stops the CLI-managed local stack. The web status page checks API availability and network alignment. Vault reads expose SDK errors in the dashboard, and the browser retries HTTP 429 with bounded backoff.

Test deposits are intentionally off. Enable them only in an isolated environment with disposable assets, matching API and frontend networks, and a confirmed recovery plan. The key and address are derived from the specific origin and wallet. Verify version 1 support in the wallet before testing a deposit.

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

The lockfile installed successfully and lint, strict type checking, six unit tests and a Next.js production build passed locally. All 11 requested web and legal routes returned HTTP 200 on the built server. A disposable PostgreSQL instance passed `pnpm test:api` smoke checks for nonce replay rejection, private-route access control, encrypted negotiation, screening denial with an injected feed fixture, wallet rate limiting and fail-closed funding and sealing. The current public OFAC feed was separately downloaded and parsed successfully. A browser wallet, zolana, funded devnet accounts, Vercel and Railway were outside these checks.

To repeat the API smoke test, set `VEIL_TEST_DATABASE_URL` to a disposable loopback Postgres database and run `pnpm test:api`. The script starts a test API on port 4319 with a synthetic screening feed and test wallets. It applies migrations and writes temporary negotiation records.
