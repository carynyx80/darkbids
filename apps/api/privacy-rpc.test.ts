import {
	type Address,
	address,
	appendTransactionMessageInstruction,
	blockhash,
	compileTransaction,
	createTransactionMessage,
	getBase64EncodedWireTransaction,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	signatureBytes,
} from "@solana/kit";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { expect, test, vi } from "vitest";
import {
	readBoundedPrivacyResponse,
	readPrivacyRequest,
	readPrivacySubmission,
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

test("the RPC relay allows simulation only with signature verification disabled", () => {
	const options = {
		encoding: "base64",
		sigVerify: false,
		replaceRecentBlockhash: true,
	};
	const simulation = {
		...query,
		method: "simulateTransaction",
		params: ["AA==", options],
	};
	expect(readPrivacyRequest("rpc", simulation)).toEqual(simulation);
	for (const override of [
		{ sigVerify: true },
		{ replaceRecentBlockhash: false },
		{ accounts: { addresses: [tag] } },
	]) {
		expect(() =>
			readPrivacyRequest("rpc", {
				...simulation,
				params: ["AA==", { ...options, ...override }],
			}),
		).toThrow();
	}
});

test("only a canonical Rings transaction signed by the session fee payer can be submitted", () => {
	const signer = nacl.sign.keyPair();
	const payer = address(bs58.encode(signer.publicKey));
	const rings = address("ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW");
	const message = setTransactionMessageLifetimeUsingBlockhash(
		{ blockhash: blockhash(tag), lastValidBlockHeight: 50n },
		setTransactionMessageFeePayer(
			payer,
			createTransactionMessage({ version: 1 }),
		),
	);
	const requestFor = (programAddress: Address, signed: boolean) => {
		const transaction = compileTransaction(
			appendTransactionMessageInstruction(
				{ programAddress, data: new Uint8Array(1400) },
				message,
			),
		);
		const signatures = signed
			? {
					[payer]: signatureBytes(
						nacl.sign.detached(
							new Uint8Array(transaction.messageBytes),
							signer.secretKey,
						),
					),
				}
			: transaction.signatures;
		return {
			...query,
			method: "sendTransaction",
			params: [
				getBase64EncodedWireTransaction({ ...transaction, signatures }),
				{ encoding: "base64", preflightCommitment: "confirmed" },
			],
		};
	};
	const valid = requestFor(rings, true);
	expect(readPrivacySubmission(valid, payer)).toEqual(valid);
	expect(readPrivacySubmission(valid, tag)).toBeUndefined();
	expect(
		readPrivacySubmission(requestFor(rings, false), payer),
	).toBeUndefined();
	expect(
		readPrivacySubmission(requestFor(address(tag), true), payer),
	).toBeUndefined();
	expect(readPrivacyRequest("rpc", valid)).toBeUndefined();
});
