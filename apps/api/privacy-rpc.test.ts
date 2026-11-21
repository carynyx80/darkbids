import { expect, test, vi } from "vitest";
import {
	readBoundedPrivacyResponse,
	readPrivacyRequest,
	relayPrivacyRead,
} from "./privacy-rpc";

const tag = "11111111111111111111111111111111";
const query = {
	jsonrpc: "2.0",
	id: 1,
	method: "getEncryptedUtxosByTags",
	params: { tags: [tag], limit: 100, filters: { slot: { gt: "100" } } },
};

test("the read relay accepts scoped reads and rejects writes, batches, and unexpected fields", () => {
	expect(readPrivacyRequest("indexer", query, query.method)).toEqual(query);
	expect(
		readPrivacyRequest("indexer", query, "getShieldedTransactionsByTags"),
	).toBeUndefined();
	expect(
		readPrivacyRequest("rpc", { ...query, method: "sendTransaction" }),
	).toBeUndefined();
	expect(() =>
		readPrivacyRequest("rpc", {
			...query,
			method: "getProgramAccounts",
			params: [tag, {}],
		}),
	).toThrow();
	expect(() => readPrivacyRequest("indexer", [query], query.method)).toThrow();
	expect(() =>
		readPrivacyRequest(
			"indexer",
			{ ...query, params: { ...query.params, viewingKey: "private" } },
			query.method,
		),
	).toThrow();
});

test("the relay uses the fixed mainnet endpoint and preserves raw JSON numbers", async () => {
	const raw = '{"jsonrpc":"2.0","id":1,"result":18446744073709551615}';
	const upstream = vi.fn<typeof fetch>(async () => new Response(raw));
	vi.stubGlobal("fetch", upstream);
	try {
		const parsed = readPrivacyRequest("indexer", query, query.method);
		if (!parsed) throw new Error("Fixture request was rejected");
		const response = await relayPrivacyRead(
			"indexer",
			parsed,
			"server-only-key",
		);
		const [url, init] = upstream.mock.calls[0];
		const destination = new URL(String(url));
		expect(destination.hostname).toBe("mainnet.helius-rpc.com");
		expect(destination.pathname).toBe("/v1/spr/getEncryptedUtxosByTags");
		expect(destination.searchParams.get("api-key")).toBe("server-only-key");
		expect(init?.redirect).toBe("error");
		expect(init?.body).not.toContain("server-only-key");
		expect((await readBoundedPrivacyResponse(response))?.toString()).toBe(raw);
	} finally {
		vi.unstubAllGlobals();
	}
});
