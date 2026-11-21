import { encode } from "@veil/core/vault";
import { expect, test, vi } from "vitest";

test("hydrating a vault makes no request with the seed and sync keeps it local", async () => {
	const requests: string[] = [];
	const seed = new Uint8Array(32).fill(42);
	vi.stubEnv("NEXT_PUBLIC_NETWORK", "localnet");
	vi.stubEnv("NEXT_PUBLIC_HELIUS_RPC_URL", "");
	vi.stubGlobal(
		"fetch",
		async (input: string | Request | URL, init?: RequestInit) => {
			requests.push(JSON.stringify([String(input), init?.body]));
			return new Response("Unavailable", { status: 503 });
		},
	);
	try {
		const { openPrivacy } = await import("./privacy");
		const session = await openPrivacy(seed);
		try {
			expect(requests).toEqual([]);
			await expect(session.read()).rejects.toThrow();
			expect(requests.length).toBeGreaterThan(0);
			for (const request of requests) {
				expect(request).not.toContain(encode(seed));
				expect(request).not.toContain(Buffer.from(seed).toString("hex"));
				expect(request).not.toMatch(/nullifierSecret|viewingKey|secretKey/i);
			}
		} finally {
			session.destroy();
		}
	} finally {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	}
});

test("a browser proof request cannot fall back to HTTP", async () => {
	const fetcher = vi.fn(async () => new Response());
	vi.stubGlobal("fetch", fetcher);
	try {
		const { proofNetworkFetch } = await import("./privacy");
		await expect(
			proofNetworkFetch("http://127.0.0.1:3001/prove", {
				method: "POST",
				body: '{"witness":"test"}',
			}),
		).rejects.toThrow("inside the browser");
		await expect(
			proofNetworkFetch("https://example.test/api", {
				method: "POST",
				body: '{"nullifier_secret":"test"}',
			}),
		).rejects.toThrow("Key material");
		expect(fetcher).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
	}
});

test("mainnet vault reads use the authenticated indexer and leave transactions disabled", async () => {
	vi.resetModules();
	vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
	vi.stubEnv("NEXT_PUBLIC_VAULT_NETWORK", "mainnet");
	vi.stubEnv("NEXT_PUBLIC_ENABLE_TEST_DEPOSITS", "true");
	vi.stubEnv("NEXT_PUBLIC_ENABLE_TEST_SPENDS", "true");
	const calls: Request[] = [];
	vi.stubGlobal("fetch", async (request: Request) => {
		calls.push(request);
		return new Response("Unavailable", { status: 503 });
	});
	try {
		const { openPrivacy, depositsEnabled, spendingEnabled } = await import(
			"./privacy"
		);
		expect(depositsEnabled).toBe(false);
		expect(spendingEnabled).toBe(false);
		const seed = new Uint8Array(32).fill(29);
		await expect(openPrivacy(seed)).rejects.toThrow("Sign in");
		const vault = await openPrivacy(seed, "test-session");
		try {
			await expect(vault.read()).rejects.toThrow();
			expect(calls.length).toBeGreaterThan(0);
			for (const request of calls) {
				expect(request.url).toMatch(
					/^https:\/\/api\.example\.test\/vault\/mainnet\//,
				);
				expect(request.headers.get("authorization")).toBe(
					"Bearer test-session",
				);
				expect(request.redirect).toBe("error");
				expect(await request.clone().text()).not.toContain(encode(seed));
			}
		} finally {
			vault.destroy();
		}
	} finally {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		vi.resetModules();
	}
});

test("mainnet accepts only SOL and opt-in native USDC for vault transactions", async () => {
	vi.stubEnv("NEXT_PUBLIC_VAULT_NETWORK", "mainnet");
	vi.stubEnv("NEXT_PUBLIC_ENABLE_MAINNET_VAULT_WRITES", "true");
	const otherMint = "So11111111111111111111111111111111111111112";
	try {
		vi.resetModules();
		vi.stubEnv("NEXT_PUBLIC_ENABLE_MAINNET_USDC", "false");
		const solOnly = await import("./privacy");
		expect(solOnly.resolveVaultAsset("")).toBeTruthy();
		expect(() =>
			solOnly.resolveVaultAsset(solOnly.MAINNET_USDC_MINT),
		).toThrow();

		vi.resetModules();
		vi.stubEnv("NEXT_PUBLIC_ENABLE_MAINNET_USDC", "true");
		const solAndUsdc = await import("./privacy");
		expect(solAndUsdc.resolveVaultAsset(solAndUsdc.MAINNET_USDC_MINT)).toBe(
			solAndUsdc.MAINNET_USDC_MINT,
		);
		expect(() => solAndUsdc.resolveVaultAsset(otherMint)).toThrow();
	} finally {
		vi.unstubAllEnvs();
		vi.resetModules();
	}
});
