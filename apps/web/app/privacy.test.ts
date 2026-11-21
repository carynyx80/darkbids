import { expect, test, vi } from "vitest";
import { encode } from "@veil/core/vault";

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
