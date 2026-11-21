import { APP_NAME } from "@veil/core/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
	authMessage,
	envelope,
	listingInput,
	offerInput,
	walletAddress,
} from "@veil/core/contracts";
import bs58 from "bs58";
import Fastify, { type FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import pg from "pg";
import nacl from "tweetnacl";
import { z } from "zod";
import {
	readBoundedPrivacyResponse,
	readPrivacyRequest,
	relayPrivacyRead,
} from "./privacy-rpc";
import { OfacProvider } from "./screening";

const config = z
	.object({
		DATABASE_URL: z.url(),
		JWT_SECRET: z.string().min(32),
		WEB_ORIGIN: z.url(),
		PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
		HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
		NEXT_PUBLIC_NETWORK: z
			.enum(["localnet", "devnet", "mainnet"])
			.default("devnet"),
		TREASURY_WALLET_ADDRESS: walletAddress.or(z.literal("")).optional(),
		TREASURY_WALLET_NETWORK: z.enum(["devnet", "mainnet"]).optional(),
		HELIUS_MAINNET_API_KEY: z.string().trim().min(1).optional(),
		ENABLE_MAINNET_VAULT_READS: z.enum(["true", "false"]).default("false"),
		ENABLE_MAINNET: z.enum(["true", "false"]).default("false"),
	})
	.parse(process.env);
if (config.NEXT_PUBLIC_NETWORK === "mainnet") {
	if (config.ENABLE_MAINNET !== "true")
		throw new Error("Mainnet requires explicit server enablement");
	throw new Error("Mainnet launch is pending settlement verification");
}

const origin = new URL(config.WEB_ORIGIN).origin;
const secret = new TextEncoder().encode(config.JWT_SECRET);
const pool = new pg.Pool({
	connectionString: config.DATABASE_URL,
	connectionTimeoutMillis: 3000,
});
for (const migration of ["001.sql", "002.sql"]) {
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
await api.register(cors, { origin, methods: ["GET", "POST", "DELETE"] });
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

const walletLimits = new Map<string, number>();
const resetLimits = setInterval(() => walletLimits.clear(), 60_000);
resetLimits.unref();

function limitWallet(wallet: string) {
	const count = (walletLimits.get(wallet) ?? 0) + 1;
	if (count > 30) throw new Rejection(429, "Too many requests");
	walletLimits.set(wallet, count);
}

async function walletOf(request: FastifyRequest) {
	const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
	if (!token) throw new Rejection(401, "Connect and sign in");
	const result = await jwtVerify(token, secret, {
		issuer: origin,
		audience: "veil-otc",
		algorithms: ["HS256"],
	}).catch(() => {
		throw new Rejection(401, "Sign in again");
	});
	const wallet = walletAddress.parse(result.payload.sub);
	limitWallet(wallet);
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
	if (error instanceof Rejection)
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

const mainnetVaultReads =
	config.ENABLE_MAINNET_VAULT_READS === "true" &&
	Boolean(config.HELIUS_MAINNET_API_KEY);

api.post("/vault/mainnet/:kind/:method?", async (request, reply) => {
	const { kind, method } = z
		.object({
			kind: z.enum(["rpc", "indexer"]),
			method: z.string().optional(),
		})
		.parse(request.params);
	if (!mainnetVaultReads || !config.HELIUS_MAINNET_API_KEY)
		throw new Rejection(503, "Mainnet vault reads are unavailable");
	await walletOf(request);
	if (kind === "rpc" && method) throw new Rejection(400, "Invalid RPC path");
	const payload = readPrivacyRequest(kind, request.body, method);
	if (!payload)
		throw new Rejection(403, "This mainnet RPC action is unavailable");
	const upstream = await relayPrivacyRead(
		kind,
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
	await pool.query("SELECT 1");
	return {
		network: config.NEXT_PUBLIC_NETWORK,
		database: "connected",
		settlement: "unavailable",
		mainnetVaultReads,
		treasuryWallet: config.TREASURY_WALLET_ADDRESS || null,
		treasuryNetwork: config.TREASURY_WALLET_ADDRESS
			? (config.TREASURY_WALLET_NETWORK ?? config.NEXT_PUBLIC_NETWORK)
			: null,
	};
});

api.post("/auth/nonce", async (request) => {
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
				authMessage(origin, wallet, nonce, expiry.toISOString()),
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
		.setIssuer(origin)
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
		`SELECT ${columns} FROM listing WHERE NOT cancelled AND expires_at > now()
     AND ($1::text IS NULL OR quote=$1) AND ($2::text IS NULL OR category=$2)
     ORDER BY ${order} LIMIT 21 OFFSET $3`,
		[filters.quote ?? null, filters.category ?? null, (filters.page - 1) * 20],
	);
	return { items: result.rows.slice(0, 20), hasNext: result.rows.length > 20 };
});

api.get("/listings/:id", async (request) => {
	const row = (
		await pool.query(
			`SELECT ${columns} FROM listing WHERE id=$1 AND NOT cancelled`,
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
		"UPDATE listing SET cancelled=true WHERE id=$1 AND seller=$2 AND NOT cancelled",
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
		"SELECT seller FROM listing WHERE id=$1 AND NOT cancelled AND expires_at > now()",
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
		`SELECT o.id, o.listing_id, o.buyer, l.seller, l.expires_at,
     CASE WHEN l.cancelled THEN 'CANCELLED' WHEN l.expires_at <= now() THEN 'EXPIRED'
     WHEN o.accepted_at IS NOT NULL THEN 'ACCEPTED' ELSE 'OFFERED' END AS state,
     CASE WHEN l.seller=$2 THEN o.ciphertext END AS ciphertext,
     CASE WHEN l.seller=$2 THEN o.seller_terms ELSE o.buyer_terms END AS terms,
     CASE WHEN l.seller=$2 THEN o.encryption_key END AS buyer_encryption_key
     FROM offer o JOIN listing l ON l.id=o.listing_id WHERE o.id=$1 AND ($2=l.seller OR $2=o.buyer)`,
		[idOf(request), wallet],
	);
	if (!result.rowCount) throw new Rejection(404, "Deal unavailable");
	return result.rows[0];
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
			"SELECT id FROM listing WHERE id=$1 AND NOT cancelled AND expires_at > now() FOR UPDATE",
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

for (const action of ["fund", "seal"]) {
	api.post(`/deals/:id/${action}`, async (request) => {
		const wallet = await walletOf(request);
		idOf(request);
		await screen(wallet);
		throw new Rejection(503, "Confidential settlement is unavailable");
	});
}
api.get("/burns", async () => ({ items: [], job: "unavailable" }));

await api.listen({ host: config.HOST, port: config.PORT });
