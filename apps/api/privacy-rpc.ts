import { z } from "zod";

const address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const slot = z.union([z.int().nonnegative(), z.string().regex(/^\d{1,20}$/)]);
const controls = {
	limit: z.int().min(1).max(1000).optional(),
	paginationToken: z.string().max(500).optional(),
	filters: z.strictObject({ slot: z.strictObject({ gt: slot }) }).optional(),
	minContextSlot: slot.optional(),
};
const commitment = z.enum(["processed", "confirmed", "finalized"]);
const accountOptions = z.strictObject({
	commitment: commitment.optional(),
	encoding: z.literal("base64"),
});
const pool = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const rpcMethods = {
	getAccountInfo: z.tuple([address, accountOptions]),
	getProgramAccounts: z.tuple([
		z.literal(pool),
		z.strictObject({
			commitment: commitment.optional(),
			encoding: z.literal("base64"),
			filters: z.tuple([
				z.strictObject({ dataSize: z.literal(48) }),
				z.strictObject({
					memcmp: z.strictObject({
						offset: z.literal(0),
						encoding: z.literal("base64"),
						bytes: z.literal("BQ=="),
					}),
				}),
			]),
		}),
	]),
};
const tags = z.strictObject({
	tags: z.array(address).min(1).max(64),
	...controls,
});
const indexerMethods = {
	getEncryptedUtxosByTags: tags,
	getShieldedTransactionsByTags: tags,
	getShieldedTransactionsByNullifiers: z.strictObject({
		nullifiers: z.array(address).min(1).max(64),
		...controls,
	}),
};
const envelope = z.strictObject({
	jsonrpc: z.literal("2.0"),
	id: z.union([z.int(), z.string().max(64)]),
	method: z.string(),
	params: z.unknown(),
});

export function readPrivacyRequest(
	kind: "rpc" | "indexer",
	value: unknown,
	indexerMethod?: string,
) {
	const request = envelope.parse(value);
	const methods: Record<string, z.ZodType> =
		kind === "rpc" ? rpcMethods : indexerMethods;
	if (
		!Object.hasOwn(methods, request.method) ||
		(kind === "indexer" && indexerMethod !== request.method)
	) {
		return undefined;
	}
	methods[request.method].parse(request.params);
	return request;
}

export function relayPrivacyRead(
	kind: "rpc" | "indexer",
	request: NonNullable<ReturnType<typeof readPrivacyRequest>>,
	key: string,
) {
	const path = kind === "rpc" ? "/" : `/v1/spr/${request.method}`;
	const upstream = new URL(path, "https://mainnet.helius-rpc.com");
	upstream.searchParams.set("api-key", key);
	return fetch(upstream, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
		redirect: "error",
		signal: AbortSignal.timeout(20_000),
	});
}

export async function readBoundedPrivacyResponse(response: Response) {
	const maxBytes = 8 * 1024 * 1024;
	const reader = response.body?.getReader();
	if (!reader) return undefined;
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return Buffer.concat(chunks, size);
			size += value.length;
			if (size > maxBytes) {
				await reader.cancel();
				return undefined;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
}
