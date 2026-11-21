import bs58 from "bs58";
import { z } from "zod";
import { buckets, categories, quotes } from "./config";

export const walletAddress = z
	.string()
	.min(32)
	.max(44)
	.refine((value) => {
		try {
			return bs58.decode(value).length === 32;
		} catch {
			return false;
		}
	}, "Invalid Solana address");

export const envelope = z
	.string()
	.max(8192)
	.regex(/^[A-Za-z0-9+/]{43}=\.[A-Za-z0-9+/]{32}\.[A-Za-z0-9+/]+={0,2}$/);
export const encryptionKey = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
export const listingInput = z.strictObject({
	mint: walletAddress.nullable(),
	category: z.enum(categories),
	bucket: z.enum(buckets),
	quote: z.enum(quotes),
	expiresAt: z.iso.datetime(),
	encryptionKey,
	ciphertext: envelope,
});
export const offerInput = z.strictObject({
	encryptionKey,
	ciphertext: envelope,
});
export const termsInput = z.strictObject({
	mint: walletAddress,
	size: z
		.string()
		.max(40)
		.regex(/^\d+(\.\d+)?$/),
	price: z
		.string()
		.max(40)
		.regex(/^\d+(\.\d+)?$/),
	minimumFill: z
		.string()
		.max(40)
		.regex(/^\d+(\.\d+)?$/)
		.optional(),
	quote: z.enum(quotes),
});
export const authMessage = (
	origin: string,
	wallet: string,
	nonce: string,
	expiresAt: string,
) =>
	`${new URL(origin).host} requests authorization for the VEIL OTC desk.\nWallet: ${wallet}\nOrigin: ${origin}\nNonce: ${nonce}\nExpires: ${expiresAt}`;
