import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { address } from "@solana/kit";
import { APP_NAME } from "@veil/core/config";
import {
	authMessage,
	envelope,
	listingInput,
	offerInput,
	walletAddress,
} from "@veil/core/contracts";
import {
	settlementApprovalInput,
	settlementApprovalMessage,
} from "@veil/core/settlement-approval";
import bs58 from "bs58";
import Fastify, { type FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import pg from "pg";
import nacl from "tweetnacl";
import { z } from "zod";
import {
	createDvpService,
	DvpError,
	dvpAction,
	dvpPrepare,
	dvpSubmit,
} from "./dvp-service";
import { isPilotDeal, pilotWallets } from "./otc-pilot";
import { registerOtcWorkflows } from "./otc-workflows";
import {
	readBoundedPrivacyResponse,
	readPrivacyRequest,
	readPrivacySubmission,
	relayPrivacyRead,
} from "./privacy-rpc";
import { OfacProvider } from "./screening";

const config = z
	.object({
		DATABASE_URL: z.url(),
		JWT_SECRET: z.string().min(32),
		WEB_ORIGIN: z.url(),
		ADDITIONAL_WEB_ORIGIN: z.url().optional(),
		PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
		HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
		NEXT_PUBLIC_NETWORK: z
			.enum(["localnet", "devnet", "mainnet"])
			.default("devnet"),
		TREASURY_WALLET_ADDRESS: walletAddress.or(z.literal("")).optional(),
		TREASURY_WALLET_NETWORK: z.enum(["devnet", "mainnet"]).optional(),
		HELIUS_MAINNET_API_KEY: z.string().trim().min(1).optional(),
		ENABLE_MAINNET_VAULT_WRITES: z.enum(["true", "false"]).default("false"),
		ENABLE_MAINNET_VAULT_READS: z.enum(["true", "false"]).default("false"),
		ENABLE_MAINNET_OTC_SETTLEMENT: z.enum(["true", "false"]).default("false"),
		OTC_PILOT_WALLETS: z.string().optional(),
		ENABLE_CAPPED_PUBLIC_OTC_BETA: z.enum(["true", "false"]).default("false"),
		OTC_SETTLEMENT_SIGNER_SEED: z.base64().optional(),
		ENABLE_MAINNET: z.enum(["true", "false"]).default("false"),
	})
	.parse(process.env);
if (
	config.NEXT_PUBLIC_NETWORK === "mainnet" &&
	config.ENABLE_MAINNET !== "true"
)
	throw new Error("Mainnet requires explicit server enablement");

const pilot = config.OTC_PILOT_WALLETS
	? pilotWallets.parse(
			config.OTC_PILOT_WALLETS.split(",").map((item) => item.trim()),
		)
	: undefined;
const publicSettlement = config.ENABLE_CAPPED_PUBLIC_OTC_BETA === "true";
if (
	config.ENABLE_MAINNET_OTC_SETTLEMENT === "true" &&
	((!publicSettlement && !pilot) ||
		config.NEXT_PUBLIC_NETWORK !== "mainnet" ||
		!config.HELIUS_MAINNET_API_KEY ||
		!config.OTC_SETTLEMENT_SIGNER_SEED ||
		!config.TREASURY_WALLET_ADDRESS ||
		config.TREASURY_WALLET_NETWORK !== "mainnet")
)
	throw new Error(
		"OTC settlement requires mainnet credentials and an access mode",
	);

const origin = new URL(config.WEB_ORIGIN).origin;
const webOrigins = config.ADDITIONAL_WEB_ORIGIN
	? [origin, new URL(config.ADDITIONAL_WEB_ORIGIN).origin]
	: [origin];
const secret = new TextEncoder().encode(config.JWT_SECRET);
const pool = new pg.Pool({
	connectionString: config.DATABASE_URL,
	connectionTimeoutMillis: 3000,
});
for (const migration of [
	"001.sql",
	"002.sql",
	"003.sql",
	"004.sql",
	"005.sql",
	"006.sql",
]) {
	await pool.query(
		await readFile(
			new URL(`./migrations/${migration}`, import.meta.url),
			"utf8",
		),
	);
}
const screening = new OfacProvider();
const api = Fastify({ logger: false, bodyLimit: 20_000 });
await api.register(rateLimit, { max: 80, timeWindow: "1 minute" });
await api.register(cors, {
	origin: webOrigins,
	methods: ["GET", "POST", "DELETE"],
});
await api.register(swagger, {
	openapi: { info: { title: `${APP_NAME} API`, version: "0.1.0" } },
});
await api.register(swaggerUi, { routePrefix: "/docs" });

class Rejection extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function authOrigin(request: FastifyRequest) {
	const requested = request.headers.origin;
	if (!requested) return origin;
	if (!webOrigins.includes(requested))
		throw new Rejection(403, "Wallet sign-in origin is unavailable");
	return requested;
}

const walletLimits = new Map<string, number>();
const resetLimits = setInterval(() => walletLimits.clear(), 60_000);
resetLimits.unref();

const walletRequestLimits = { desk: 30, vaultRead: 60, vaultSubmit: 8 };
type WalletRequestScope = keyof typeof walletRequestLimits;

function limitWallet(wallet: string, scope: WalletRequestScope = "desk") {
	const key = `${scope}:${wallet}`;
	const count = (walletLimits.get(key) ?? 0) + 1;
	if (count > walletRequestLimits[scope])
		throw new Rejection(429, "Too many requests");
	walletLimits.set(key, count);
}

async function walletOf(
	request: FastifyRequest,
	scope: WalletRequestScope = "desk",
) {
	const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
	if (!token) throw new Rejection(401, "Connect and sign in");
	const result = await jwtVerify(token, secret, {
		issuer: authOrigin(request),
		audience: "veil-otc",
		algorithms: ["HS256"],
	}).catch(() => {
		throw new Rejection(401, "Sign in again");
	});
	const wallet = walletAddress.parse(result.payload.sub);
	limitWallet(wallet, scope);
	return wallet;
}

async function screen(wallet: string) {
	const blocked = await screening.blocked(wallet).catch(() => {
		throw new Rejection(503, "Wallet screening is temporarily unavailable");
	});
	if (blocked)
		throw new Rejection(403, "This wallet is unavailable for desk activity");
}

api.setErrorHandler((error, _request, reply) => {
	if (error instanceof Rejection || error instanceof DvpError)
		return reply.code(error.status).send({ message: error.message });
	if (error instanceof z.ZodError)
		return reply.code(400).send({ message: "Invalid request" });
	const status =
		typeof error === "object" && error !== null && "statusCode" in error
			? error.statusCode
			: undefined;
	if (typeof status === "number" && status >= 400 && status < 500)
		return reply.code(status).send({ message: "Request rejected" });
	return reply.code(503).send({ message: "Service temporarily unavailable" });
});

const settlement =
	config.HELIUS_MAINNET_API_KEY &&
	config.OTC_SETTLEMENT_SIGNER_SEED &&
	config.TREASURY_WALLET_ADDRESS &&
	config.TREASURY_WALLET_NETWORK === "mainnet"
		? await createDvpService(
				pool,
				config.HELIUS_MAINNET_API_KEY,
				config.OTC_SETTLEMENT_SIGNER_SEED,
				address(config.TREASURY_WALLET_ADDRESS),
				screen,
				{ pilot, publicSettlement },
			)
		: undefined;

const settlementFunding = Boolean(
	settlement && config.ENABLE_MAINNET_OTC_SETTLEMENT === "true",
);

const mainnetVaultReads =
	config.ENABLE_MAINNET_VAULT_READS === "true" &&
	Boolean(config.HELIUS_MAINNET_API_KEY);

const mainnetVaultWrites =
	mainnetVaultReads && config.ENABLE_MAINNET_VAULT_WRITES === "true";

api.post("/vault/mainnet/:kind/:method?", async (request, reply) => {
	const { kind, method } = z
		.object({
			kind: z.enum(["rpc", "indexer", "submit"]),
			method: z.string().optional(),
		})
		.parse(request.params);
	if (!mainnetVaultReads || !config.HELIUS_MAINNET_API_KEY)
		throw new Rejection(503, "Mainnet vault reads are unavailable");
	const wallet = await walletOf(
		request,
		kind === "submit" ? "vaultSubmit" : "vaultRead",
	);
	if (kind !== "indexer" && method)
		throw new Rejection(400, "Invalid RPC path");
	if (kind === "submit" && !mainnetVaultWrites)
		throw new Rejection(503, "Mainnet vault submission is unavailable");
	const payload =
		kind === "submit"
			? readPrivacySubmission(request.body, wallet)
			: readPrivacyRequest(kind, request.body, method);
	if (!payload)
		throw new Rejection(403, "This mainnet RPC action is unavailable");
	if (kind === "submit") await screen(wallet);
	const upstream = await relayPrivacyRead(
		kind === "submit" ? "rpc" : kind,
		payload,
		config.HELIUS_MAINNET_API_KEY,
	).catch(() => {
		throw new Rejection(502, "Privacy RPC unavailable");
	});
	if (upstream.status === 429)
		throw new Rejection(429, "Privacy RPC rate limit reached");
	if (
		!upstream.ok ||
		!upstream.headers.get("content-type")?.includes("application/json")
	)
		throw new Rejection(502, "Privacy RPC unavailable");
	const body = await readBoundedPrivacyResponse(upstream);
	if (!body) throw new Rejection(413, "Privacy RPC response exceeds the limit");
	return reply
		.header("Cache-Control", "no-store")
		.type("application/json")
		.send(body);
});

api.get("/health", async () => {
	const { rows } = await pool.query(
		"SELECT trade_count,usdc_total,sol_total FROM otc_beta_budget WHERE singleton",
	);
	return {
		otcBeta: publicSettlement && settlementFunding ? rows[0] : null,
		network: config.NEXT_PUBLIC_NETWORK,
		database: "connected",
		settlement: settlementFunding
			? publicSettlement
				? "public-beta"
				: "pilot"
			: "unavailable",
		mainnetVaultReads,
		mainnetVaultWrites,
		treasuryWallet: config.TREASURY_WALLET_ADDRESS || null,
		treasuryNetwork: config.TREASURY_WALLET_ADDRESS
			? (config.TREASURY_WALLET_NETWORK ?? config.NEXT_PUBLIC_NETWORK)
			: null,
	};
});

api.post("/auth/nonce", async (request) => {
	authOrigin(request);
	const { wallet } = z
		.strictObject({ wallet: walletAddress })
		.parse(request.body);
	limitWallet(wallet);
	const nonce = randomUUID();
	const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
	await pool.query("DELETE FROM auth_nonce WHERE expires_at <= now()");
	await pool.query("INSERT INTO auth_nonce VALUES ($1,$2,$3)", [
		nonce,
		wallet,
		expiresAt,
	]);
	return { nonce, expiresAt };
});

api.post("/auth/verify", async (request) => {
	const requestOrigin = authOrigin(request);
	const { wallet, nonce, signature } = z
		.strictObject({
			wallet: walletAddress,
			nonce: z.uuid(),
			signature: z
				.base64()
				.length(88)
				.refine((value) => Buffer.from(value, "base64").length === 64),
		})
		.parse(request.body);
	limitWallet(wallet);
	const challenge = await pool.query<{ expires_at: Date }>(
		"SELECT expires_at FROM auth_nonce WHERE nonce=$1 AND wallet=$2 AND expires_at > now()",
		[nonce, wallet],
	);
	const expiry = challenge.rows[0]?.expires_at;
	if (
		!expiry ||
		!nacl.sign.detached.verify(
			new TextEncoder().encode(
				authMessage(requestOrigin, wallet, nonce, expiry.toISOString()),
			),
			Buffer.from(signature, "base64"),
			bs58.decode(wallet),
		)
	) {
		throw new Rejection(401, "Challenge verification failed");
	}
	const used = await pool.query(
		"DELETE FROM auth_nonce WHERE nonce=$1 AND wallet=$2 AND expires_at > now()",
		[nonce, wallet],
	);
	if (!used.rowCount) throw new Rejection(401, "Challenge verification failed");
	const token = await new SignJWT({})
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(wallet)
		.setIssuer(requestOrigin)
		.setAudience("veil-otc")
		.setIssuedAt()
		.setExpirationTime("10m")
		.sign(secret);
	return { token };
});

const columns =
	"id, seller, mint, category, bucket, quote, expires_at, encryption_key, created_at";
const idOf = (request: FastifyRequest) =>
	z.object({ id: z.uuid() }).parse(request.params).id;

api.get("/listings", async (request) => {
	const filters = z
		.object({
			page: z.coerce.number().int().min(1).max(1000).default(1),
			quote: z.enum(["SOL", "USDC"]).optional(),
			category: z.string().max(30).optional(),
			sort: z.enum(["newest", "expiry"]).default("newest"),
		})
		.parse(request.query);
	const order =
		filters.sort === "expiry"
			? "expires_at ASC, id ASC"
			: "created_at DESC, id DESC";
	const result = await pool.query(
		`SELECT ${columns} FROM listing WHERE NOT private_rfq AND NOT cancelled AND expires_at > now()
     AND ($1::text IS NULL OR quote=$1) AND ($2::text IS NULL OR category=$2)
     ORDER BY ${order} LIMIT 21 OFFSET $3`,
		[filters.quote ?? null, filters.category ?? null, (filters.page - 1) * 20],
	);
	return { items: result.rows.slice(0, 20), hasNext: result.rows.length > 20 };
});

api.get("/listings/:id", async (request) => {
	const row = (
		await pool.query(
			`SELECT ${columns} FROM listing WHERE id=$1 AND NOT private_rfq AND NOT cancelled`,
			[idOf(request)],
		)
	).rows[0];
	if (!row) throw new Rejection(404, "Listing unavailable");
	return row;
});

api.post("/listings", async (request, reply) => {
	const seller = await walletOf(request);
	await screen(seller);
	const input = listingInput.parse(request.body);
	const lifetime = Date.parse(input.expiresAt) - Date.now();
	if (lifetime < 30_000 || lifetime > 7 * 86400_000)
		throw new Rejection(400, "Choose an expiry within seven days");
	const id = randomUUID();
	await pool.query(
		"INSERT INTO listing (id,seller,mint,category,bucket,quote,expires_at,encryption_key,ciphertext) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
		[
			id,
			seller,
			input.mint,
			input.category,
			input.bucket,
			input.quote,
			input.expiresAt,
			input.encryptionKey,
			input.ciphertext,
		],
	);
	return reply.code(201).send({ id });
});

api.delete("/listings/:id", async (request) => {
	const wallet = await walletOf(request);
	const result = await pool.query(
		"UPDATE listing SET cancelled=true WHERE id=$1 AND seller=$2 AND NOT private_rfq AND NOT cancelled",
		[idOf(request), wallet],
	);
	if (!result.rowCount) throw new Rejection(404, "Listing unavailable");
	return { cancelled: true };
});

api.get("/listings/:id/private", async (request) => {
	const seller = await walletOf(request);
	const result = await pool.query(
		"SELECT ciphertext FROM listing WHERE id=$1 AND seller=$2",
		[idOf(request), seller],
	);
	if (!result.rowCount) throw new Rejection(404, "Listing unavailable");
	return result.rows[0];
});

api.post("/listings/:id/offers", async (request, reply) => {
	const buyer = await walletOf(request);
	const input = offerInput.parse(request.body);
	const id = randomUUID();
	await screen(buyer);
	const listing = await pool.query<{ seller: string }>(
		"SELECT seller FROM listing WHERE id=$1 AND NOT private_rfq AND NOT cancelled AND expires_at > now()",
		[idOf(request)],
	);
	const seller = listing.rows[0]?.seller;
	if (!seller || seller === buyer)
		throw new Rejection(409, "Listing unavailable for this offer");
	await screen(seller);
	const inserted = await pool.query(
		`INSERT INTO offer (id,listing_id,buyer,encryption_key,ciphertext)
     SELECT $1,id,$3,$4,$5 FROM listing WHERE id=$2 AND NOT cancelled AND expires_at > now()
     ON CONFLICT (listing_id,buyer) DO NOTHING`,
		[id, idOf(request), buyer, input.encryptionKey, input.ciphertext],
	);
	if (!inserted.rowCount)
		throw new Rejection(
			409,
			"An offer already exists or the listing has closed",
		);
	return reply.code(201).send({ id });
});

api.get("/listings/:id/offers", async (request) => {
	const seller = await walletOf(request);
	const result = await pool.query(
		"SELECT o.id, o.buyer, o.ciphertext FROM offer o JOIN listing l ON l.id=o.listing_id WHERE l.id=$1 AND l.seller=$2",
		[idOf(request), seller],
	);
	return result.rows;
});

api.get("/deals/:id", async (request) => {
	const wallet = await walletOf(request);
	const result = await pool.query(
		`SELECT o.id, o.listing_id, o.buyer, l.seller, l.expires_at, l.private_rfq,
     CASE WHEN l.cancelled THEN 'CANCELLED' WHEN l.expires_at <= now() THEN 'EXPIRED'
     WHEN o.accepted_at IS NOT NULL THEN 'ACCEPTED' ELSE 'OFFERED' END AS state,
     CASE WHEN l.seller=$2 THEN o.ciphertext END AS ciphertext,
     CASE WHEN l.seller=$2 THEN o.seller_terms ELSE o.buyer_terms END AS terms,
     CASE WHEN l.seller=$2 THEN o.encryption_key END AS buyer_encryption_key,
     CASE WHEN l.seller=$2 THEN o.encryption_key ELSE l.encryption_key END AS counterparty_encryption_key,
     CASE WHEN l.seller=$2 THEN
       (SELECT s.commitment FROM settlement_approval s WHERE s.offer_id=o.id AND s.wallet=o.buyer)
     ELSE
       (SELECT s.commitment FROM settlement_approval s WHERE s.offer_id=o.id AND s.wallet=l.seller)
     END AS counterparty_commitment,
     (SELECT s.commitment FROM settlement_approval s WHERE s.offer_id=o.id AND s.wallet=$2) AS settlement_commitment
     , EXISTS (SELECT 1 FROM settlement_dvp d WHERE d.offer_id=o.id) AS escrow_configured
     FROM offer o JOIN listing l ON l.id=o.listing_id WHERE o.id=$1 AND ($2=l.seller OR $2=o.buyer)`,
		[idOf(request), wallet],
	);
	if (!result.rowCount) throw new Rejection(404, "Deal unavailable");
	const deal = result.rows[0];
	const fundingAllowed =
		settlementFunding && (publicSettlement || isPilotDeal(pilot, deal));
	return {
		...deal,
		settlement_enabled: Boolean(
			settlement && (fundingAllowed || deal.escrow_configured),
		),
		settlement_funding_enabled: fundingAllowed,
		settlement_treasury:
			config.TREASURY_WALLET_NETWORK === "mainnet"
				? config.TREASURY_WALLET_ADDRESS || null
				: null,
	};
});

api.post("/deals/:id/accept", async (request) => {
	const wallet = await walletOf(request);
	const terms = z
		.strictObject({ sellerTerms: envelope, buyerTerms: envelope })
		.parse(request.body);
	const selection = await pool.query<{ listing_id: string; buyer: string }>(
		"SELECT o.listing_id,o.buyer FROM offer o JOIN listing l ON l.id=o.listing_id WHERE o.id=$1 AND l.seller=$2",
		[idOf(request), wallet],
	);
	const offer = selection.rows[0];
	if (!offer) throw new Rejection(404, "Deal unavailable");
	await Promise.all([screen(wallet), screen(offer.buyer)]);
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const active = await client.query(
			"SELECT id FROM listing WHERE id=$1 AND NOT private_rfq AND NOT cancelled AND expires_at > now() FOR UPDATE",
			[offer.listing_id],
		);
		if (!active.rowCount) throw new Rejection(409, "Listing unavailable");
		const existing = await client.query(
			"SELECT id FROM offer WHERE listing_id=$1 AND accepted_at IS NOT NULL",
			[offer.listing_id],
		);
		if (existing.rows[0]?.id && existing.rows[0].id !== idOf(request))
			throw new Rejection(409, "A deal is already accepted");
		await client.query(
			"UPDATE offer SET accepted_at=now(), seller_terms=$2, buyer_terms=$3 WHERE id=$1 AND accepted_at IS NULL",
			[idOf(request), terms.sellerTerms, terms.buyerTerms],
		);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
	return { state: "ACCEPTED" };
});

api.post("/deals/:id/settlement-approval", async (request) => {
	const wallet = await walletOf(request);
	const id = idOf(request);
	const input = settlementApprovalInput.parse(request.body);
	const treasury = config.TREASURY_WALLET_ADDRESS;
	if (!treasury || config.TREASURY_WALLET_NETWORK !== "mainnet")
		throw new Rejection(503, "Mainnet settlement terms are unavailable");
	await screen(wallet);
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const selection = await client.query<{
			seller: string;
			buyer: string;
			expires_at: Date;
		}>(
			`SELECT l.seller, o.buyer, l.expires_at FROM offer o JOIN listing l ON l.id=o.listing_id
			 WHERE o.id=$1 AND ($2=l.seller OR $2=o.buyer)
			 AND o.accepted_at IS NOT NULL AND NOT l.cancelled AND l.expires_at > now()
			 FOR UPDATE OF l, o`,
			[id, wallet],
		);
		const deal = selection.rows[0];
		if (!deal) throw new Rejection(404, "Active accepted deal unavailable");
		if (deal.seller === deal.buyer)
			throw new Rejection(409, "Settlement requires two different wallets");
		const signature = Buffer.from(input.signature, "base64");
		const message = settlementApprovalMessage(
			{
				id,
				seller: deal.seller,
				buyer: deal.buyer,
				expiresAt: deal.expires_at.toISOString(),
			},
			treasury,
			input.commitment,
		);
		if (
			signature.length !== 64 ||
			!nacl.sign.detached.verify(message, signature, bs58.decode(wallet))
		)
			throw new Rejection(401, "Invalid settlement approval signature");

		const existing = await client.query<{ commitment: string }>(
			"SELECT commitment FROM settlement_approval WHERE offer_id=$1",
			[id],
		);
		if (
			existing.rows.some((approval) => approval.commitment !== input.commitment)
		)
			throw new Rejection(
				409,
				"Settlement terms differ from the recorded approval",
			);
		await client.query(
			`INSERT INTO settlement_approval (offer_id, wallet, commitment, signature)
			 VALUES ($1,$2,$3,$4) ON CONFLICT (offer_id,wallet) DO NOTHING`,
			[id, wallet, input.commitment, input.signature],
		);
		await client.query("COMMIT");
		return { approved: true };
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
});

api.get("/deals/:id/escrow", async (request) => {
	const wallet = await walletOf(request);
	if (!settlement) throw new Rejection(503, "OTC escrow is unavailable");
	return settlement.status(idOf(request), wallet);
});

api.post("/deals/:id/escrow/prepare/:action", async (request) => {
	const wallet = address(await walletOf(request));
	const { action } = z.object({ action: dvpAction }).parse(request.params);
	if (!settlement || (!settlementFunding && action !== "refund"))
		throw new Rejection(503, "OTC escrow is unavailable");
	return settlement.prepare(
		idOf(request),
		wallet,
		action,
		dvpPrepare.parse(request.body),
	);
});

api.post("/deals/:id/escrow/submit", async (request) => {
	const wallet = address(await walletOf(request));
	if (!settlement) throw new Rejection(503, "OTC escrow is unavailable");
	return settlement.submit(
		idOf(request),
		wallet,
		dvpSubmit.parse(request.body),
		settlementFunding,
	);
});

for (const action of ["fund", "seal"]) {
	api.post(`/deals/:id/${action}`, async (request) => {
		const wallet = await walletOf(request);
		idOf(request);
		await screen(wallet);
		throw new Rejection(503, "Confidential settlement is unavailable");
	});
}
api.get("/burns", async () => ({ items: [], job: "unavailable" }));

api.get("/deals/:id/receipt", async (request) => {
	const wallet = await walletOf(request);
	if (!settlement) throw new Rejection(503, "OTC settlement is unavailable");
	return settlement.confirmedReceipt(idOf(request), wallet);
});

registerOtcWorkflows(api, {
	pool,
	walletOf,
	screen,
	Rejection,
	treasury:
		config.TREASURY_WALLET_NETWORK === "mainnet"
			? config.TREASURY_WALLET_ADDRESS
			: undefined,
});

await api.listen({ host: config.HOST, port: config.PORT });
