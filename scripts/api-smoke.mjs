import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const database = process.env.VEIL_TEST_DATABASE_URL;
if (!database || new URL(database).hostname !== "127.0.0.1") {
	throw new Error(
		"Set VEIL_TEST_DATABASE_URL to a dedicated, disposable loopback Postgres database",
	);
}
const apiDir = new URL("../apps/api/", import.meta.url);
const require = createRequire(new URL("package.json", apiDir));
const nacl = require("tweetnacl");
const { default: bs58 } = require("bs58");
const keypair = () => {
	const key = nacl.sign.keyPair();
	return { ...key, address: bs58.encode(key.publicKey) };
};
const seller = keypair();
const buyer = keypair();
const blocked = keypair();
const outsider = keypair();
const feed = `<sdnList><sdnEntry><idList><id><idType>Digital Currency Address - SOL</idType><idNumber>${blocked.address}</idNumber></id></idList></sdnEntry></sdnList>`;
const fixture = `data:text/javascript,${encodeURIComponent(`globalThis.fetch = async () => new Response(${JSON.stringify(feed)});`)}`;
const origin = "http://127.0.0.1:4318";
const api = spawn(
	process.execPath,
	["--import", "tsx", "--import", fixture, "server.ts"],
	{
		cwd: apiDir,
		env: {
			...process.env,
			HOST: "127.0.0.1",
			PORT: "4319",
			WEB_ORIGIN: origin,
			JWT_SECRET: randomBytes(32).toString("hex"),
			DATABASE_URL: database,
			NEXT_PUBLIC_NETWORK: "devnet",
		},
		stdio: "inherit",
	},
);
async function call(path, status, { method = "GET", token, body } = {}) {
	const response = await fetch(`http://127.0.0.1:4319${path}`, {
		method,
		headers: {
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(body ? { "content-type": "application/json" } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = await response.json();
	assert.equal(
		response.status,
		status,
		`${method} ${path} returned ${JSON.stringify(json)}`,
	);
	return json;
}
async function auth(pair) {
	const { nonce, expiresAt } = await call("/auth/nonce", 200, {
		method: "POST",
		body: { wallet: pair.address },
	});
	const message = `127.0.0.1:4318 requests authorization for the VEIL OTC desk.\nWallet: ${pair.address}\nOrigin: ${origin}\nNonce: ${nonce}\nExpires: ${expiresAt}`;
	const signature = Buffer.from(
		nacl.sign.detached(new TextEncoder().encode(message), pair.secretKey),
	).toString("base64");
	const body = { wallet: pair.address, nonce, signature };
	const result = await call("/auth/verify", 200, { method: "POST", body });
	await call("/auth/verify", 401, { method: "POST", body });
	return result.token;
}
const pub = (pair) => Buffer.from(pair.publicKey).toString("base64");
const ciphertext = `${pub(seller)}.${Buffer.alloc(24).toString("base64")}.${Buffer.from("ciphertext fixture").toString("base64")}`;
try {
	for (let i = 0; i < 40; i++) {
		if (api.exitCode !== null) throw new Error("API quit prematurely");
		if (
			await fetch("http://127.0.0.1:4319/health").then(
				(result) => result.ok,
				() => false,
			)
		)
			break;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	await call("/health", 200);
	const sellerToken = await auth(seller);
	const buyerToken = await auth(buyer);
	const outsiderToken = await auth(outsider);
	const blockedToken = await auth(blocked);
	const listing = {
		mint: null,
		category: "Large cap",
		bucket: "Under $1k",
		quote: "SOL",
		expiresAt: new Date(Date.now() + 90_000).toISOString(),
		encryptionKey: pub(seller),
		ciphertext,
	};
	await call("/listings", 403, {
		method: "POST",
		token: blockedToken,
		body: listing,
	});
	const { id } = await call("/listings", 201, {
		method: "POST",
		token: sellerToken,
		body: listing,
	});
	const board = await call("/listings?quote=SOL", 200);
	assert.equal(board.items[0].id, id);
	assert.ok(!("ciphertext" in board.items[0]));
	await call(`/listings/${id}/private`, 404, { token: outsiderToken });
	await call(`/listings/${id}/offers`, 403, {
		method: "POST",
		token: blockedToken,
		body: { encryptionKey: pub(blocked), ciphertext },
	});
	const offer = await call(`/listings/${id}/offers`, 201, {
		method: "POST",
		token: buyerToken,
		body: { encryptionKey: pub(buyer), ciphertext },
	});
	const room = `/deals/${offer.id}`;
	const acceptance = { sellerTerms: ciphertext, buyerTerms: ciphertext };
	await call(room, 404, { token: outsiderToken });
	await call(`${room}/accept`, 404, {
		method: "POST",
		token: buyerToken,
		body: acceptance,
	});
	await call(`${room}/accept`, 200, {
		method: "POST",
		token: sellerToken,
		body: acceptance,
	});
	const accepted = await call(room, 200, { token: buyerToken });
	assert.equal(accepted.state, "ACCEPTED");
	assert.equal(accepted.terms, ciphertext);
	assert.equal(accepted.ciphertext, null);
	await call(`${room}/fund`, 503, { method: "POST", token: sellerToken });
	await call(`${room}/seal`, 503, { method: "POST", token: buyerToken });
	await call(`${room}/seal`, 403, { method: "POST", token: blockedToken });
	await call(`/listings/${id}`, 200, { method: "DELETE", token: sellerToken });
	assert.equal(
		(await call(room, 200, { token: buyerToken })).state,
		"CANCELLED",
	);
	let rateLimited = false;
	for (let i = 0; i < 32; i++) {
		const response = await fetch(`http://127.0.0.1:4319${room}`, {
			headers: { authorization: `Bearer ${buyerToken}` },
		});
		if (response.status === 429) {
			rateLimited = true;
			break;
		}
	}
	assert.ok(rateLimited);
	console.log(
		"API and Postgres smoke passed: nonce replay, ciphertext isolation, screening, negotiation, settlement guards and wallet rate limits.",
	);
} finally {
	api.kill();
}
