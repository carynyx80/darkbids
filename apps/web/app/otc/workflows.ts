import { vaultIdentityHost } from "@veil/core/site";
import { dealEncryptionKey } from "@veil/core/vault";
import { api } from "../providers";

export const post = (body: unknown): RequestInit => ({
	method: "POST",
	body: JSON.stringify(body),
});

export async function withDeskKey<T>(
	seed: Uint8Array<ArrayBuffer>,
	run: (keys: Awaited<ReturnType<typeof dealEncryptionKey>>) => Promise<T>,
) {
	const keys = await dealEncryptionKey(
		seed,
		vaultIdentityHost(window.location.host),
	);
	try {
		return await run(keys);
	} finally {
		keys.secretKey.fill(0);
	}
}

export const contact = (wallet: string, token: string) =>
	api<{ encryption_key: string }>(`/otc/contact/${wallet}`, undefined, token);

export const errorText = (error: unknown) =>
	error instanceof Error ? error.message : "The desk action failed";

export type Policy = {
	approver: string;
	sol_threshold: string;
	usdc_threshold: string;
};

export function formatQuoteUnits(amount: bigint, decimals: number) {
	const digits = amount.toString().padStart(decimals + 1, "0");
	const fraction = digits.slice(-decimals).replace(/0+$/, "");
	return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}
