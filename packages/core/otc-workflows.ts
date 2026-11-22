import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";
import { walletAddress } from "./contracts";
import { decode } from "./vault";

const utf8 = new TextEncoder();
export const walletSignature = z.base64().length(88);
export const termsCommitment = z.base64().regex(/^[A-Za-z0-9+/]{43}=$/);
export const threshold = z.string().regex(/^\d{1,40}$/);

export function validWalletSignature(
	wallet: string,
	signature: string,
	message: Uint8Array,
) {
	try {
		const bytes = decode(signature);
		return (
			bytes.length === 64 &&
			nacl.sign.detached.verify(message, bytes, bs58.decode(wallet))
		);
	} catch {
		return false;
	}
}

export function treasuryApprovalMessage(
	deal: string,
	owner: string,
	commitment: string,
) {
	return utf8.encode(
		[
			"Primar OTC treasury authorization v1 | Solana mainnet",
			`Deal: ${deal}`,
			`Treasury owner: ${owner}`,
			`Terms commitment: ${commitment}`,
			"Approval authorizes these terms. It does not transfer funds.",
		].join("\n"),
	);
}

export const receiptFields = [
	"mint",
	"size",
	"price",
	"quote",
	"quoteTotal",
	"platformFee",
] as const;
const receiptDetails = z
	.strictObject({
		mint: walletAddress.optional(),
		size: threshold
			.or(
				z
					.string()
					.max(80)
					.regex(/^\d+\.\d+$/),
			)
			.optional(),
		price: z
			.string()
			.max(80)
			.regex(/^\d+(\.\d+)?$/)
			.optional(),
		quote: z.enum(["SOL", "USDC"]).optional(),
		quoteTotal: z
			.string()
			.max(80)
			.regex(/^\d+(\.\d+)?$/)
			.optional(),
		platformFee: z
			.string()
			.max(80)
			.regex(/^\d+(\.\d+)?$/)
			.optional(),
	})
	.refine((value) => Object.keys(value).length > 0);
export const receiptStatement = z.strictObject({
	version: z.literal(1),
	deal: z.uuid(),
	signer: walletAddress,
	transaction: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
	details: receiptDetails,
});
export const signedReceipt = z.strictObject({
	statement: receiptStatement,
	signature: walletSignature,
});
export function receiptMessage(statement: z.infer<typeof receiptStatement>) {
	return utf8.encode(
		[
			"Primar OTC trade receipt v1 | Solana mainnet",
			`Deal: ${statement.deal}`,
			`Signer: ${statement.signer}`,
			`Settlement transaction: ${statement.transaction}`,
			...receiptFields.flatMap((key) =>
				statement.details[key] === undefined
					? []
					: [`${key}: ${statement.details[key]}`],
			),
			"This is a statement from the signing wallet.",
		].join("\n"),
	);
}
