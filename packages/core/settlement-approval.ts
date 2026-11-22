import nacl from "tweetnacl";
import { z } from "zod";
import { PLATFORM_FEE_BPS } from "./config";
import { termsInput, walletAddress } from "./contracts";
import { parseUnits, quoteFee } from "./fees";
import { decode, encode } from "./vault";

const utf8 = new TextEncoder();

export const settlementApprovalInput = z.strictObject({
	commitment: z.base64().regex(/^[A-Za-z0-9+/]{43}=$/),
	signature: z.base64().length(88),
});

export const settlementOpeningInput = z.strictObject({
	terms: termsInput,
	salt: z.base64().regex(/^[A-Za-z0-9+/]{43}=$/),
});

export async function verifySettlementOpening(
	dealId: string,
	treasury: string,
	opening: z.infer<typeof settlementOpeningInput>,
) {
	const terms = termsInput.parse(opening.terms);
	const [size, sizeDecimals] = decimal(terms.size);
	const [price, priceDecimals] = decimal(terms.price);
	const quoteDecimals = terms.quote === "USDC" ? 6 : 9;
	const quoteAmount = parseUnits(
		formatUnits(size * price, sizeDecimals + priceDecimals),
		quoteDecimals,
	);
	const fee = quoteFee(quoteAmount);
	if (fee >= quoteAmount)
		throw new Error("Quote must exceed the settlement fee");
	const payload = utf8.encode(
		JSON.stringify([
			"primar-otc-terms-v1",
			dealId,
			terms.mint,
			formatUnits(size, sizeDecimals),
			formatUnits(price, priceDecimals),
			terms.quote,
			quoteAmount.toString(),
			fee.toString(),
			walletAddress.parse(treasury),
		]),
	);
	const salt = decode(opening.salt);
	const salted = new Uint8Array(salt.length + payload.length);
	salted.set(salt);
	salted.set(payload, salt.length);
	try {
		return {
			commitment: encode(
				new Uint8Array(await crypto.subtle.digest("SHA-256", salted)),
			),
			quoteAmount,
			quoteDecimals,
			quoteTotal: formatUnits(quoteAmount, quoteDecimals),
			platformFee: formatUnits(fee, quoteDecimals),
		};
	} finally {
		salted.fill(0);
		salt.fill(0);
	}
}

type Deal = { id: string; seller: string; buyer: string; expiresAt: string };

export function settlementApprovalMessage(
	deal: Deal,
	treasury: string,
	commitment: string,
) {
	return utf8.encode(
		[
			"Primar OTC settlement terms v1 | Solana mainnet",
			`Deal: ${deal.id}`,
			`Seller: ${deal.seller}`,
			`Buyer: ${deal.buyer}`,
			`Expiry: ${deal.expiresAt}`,
			`Treasury: ${treasury}`,
			`Quote fee basis points: ${PLATFORM_FEE_BPS}`,
			`Terms commitment: ${commitment}`,
			"Approval records the terms. It does not transfer funds.",
		].join("\n"),
	);
}

export async function prepareSettlementApproval(input: {
	dealId: string;
	terms: z.infer<typeof termsInput>;
	treasury: string;
	ownSecretKey: Uint8Array;
	otherPublicKey: Uint8Array;
}) {
	const shared = nacl.box.before(input.otherPublicKey, input.ownSecretKey);
	const rawKey = new Uint8Array(shared);
	shared.fill(0);
	let salt: Uint8Array<ArrayBuffer> | undefined;
	try {
		const key = await crypto.subtle.importKey(
			"raw",
			rawKey,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		salt = new Uint8Array(
			await crypto.subtle.sign(
				"HMAC",
				key,
				utf8.encode(`primar-otc-salt-v1:${input.dealId}`),
			),
		);
		const opening = { terms: input.terms, salt: encode(salt) };
		return {
			...(await verifySettlementOpening(input.dealId, input.treasury, opening)),
			opening,
		};
	} finally {
		rawKey.fill(0);
		salt?.fill(0);
	}
}

function decimal(value: string): [bigint, number] {
	const [whole, fraction = ""] = value.split(".");
	return [BigInt(whole + fraction), fraction.length];
}

function formatUnits(value: bigint, decimals: number) {
	if (!decimals) return value.toString();
	const digits = value.toString().padStart(decimals + 1, "0");
	const fraction = digits.slice(-decimals).replace(/0+$/, "");
	return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}
