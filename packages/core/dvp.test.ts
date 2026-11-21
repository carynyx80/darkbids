import { address, getAddressEncoder } from "@solana/kit";
import { expect, test } from "vitest";
import {
	createDvpInstruction,
	DVP_PROGRAM,
	type DvpTerms,
	deriveDvpTrade,
	fundDvpInstruction,
	reclaimDvpInstruction,
	recoverDvpInstruction,
	settleDvpInstructions,
	verifyDvpTrade,
} from "./dvp";

const assetTokenProgram = address(
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const terms: DvpTerms = {
	settlementAuthority: address("8wfNUw4SFJCZvC6N87M7s4sCzY4XUE4nUBJVWWTijngV"),
	seller: address("5PsyDzSgQ4cr12UwCVYhF9DuEDn1eoGMAzEZ9wgB3VNF"),
	buyer: address("EFuoydd5xsJ6kJcK78dzPpkmRQpooYQa7gbJ69QPDZxM"),
	assetMint: address("So11111111111111111111111111111111111111112"),
	quoteMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
	assetTokenProgram,
	quoteTokenProgram: assetTokenProgram,
	assetAmount: 1_000_000n,
	quoteAmount: 210_000n,
	expiry: 1_796_000_000n,
	nonce: 12_345_678_910_111_213n,
	reference: "test-deal",
};

test("funding addresses require the canonical DvP record and exact agreed terms", async () => {
	const [trade, bump] = await deriveDvpTrade(terms);
	const bytes = Buffer.alloc(458);
	const encode = getAddressEncoder().encode;
	bytes[0] = bump;
	for (const [offset, key] of [
		[1, terms.seller],
		[33, terms.buyer],
		[65, terms.assetMint],
		[97, terms.quoteMint],
		[129, terms.settlementAuthority],
		[161, terms.assetTokenProgram],
		[193, terms.quoteTokenProgram],
		[321, terms.seller],
		[353, terms.buyer],
	] as const)
		bytes.set(encode(key), offset);
	bytes.writeBigUInt64LE(terms.assetAmount, 225);
	bytes.writeBigUInt64LE(terms.quoteAmount, 233);
	bytes.writeBigInt64LE(terms.expiry, 241);
	bytes.writeBigUInt64LE(terms.nonce, 249);
	bytes.write(terms.reference, 257);

	const account = { address: trade, owner: DVP_PROGRAM, data: bytes };
	const result = await verifyDvpTrade(account, terms);
	expect(result.tradeAddress).toBe(trade);
	expect(result.assetEscrow).not.toBe(result.quoteEscrow);
	await expect(
		verifyDvpTrade({ ...account, owner: terms.seller }, terms),
	).rejects.toThrow("Invalid DvP");
	await expect(
		verifyDvpTrade(account, { ...terms, quoteAmount: 1n }),
	).rejects.toThrow("terms differ");
	await expect(
		verifyDvpTrade(account, { ...terms, expiry: terms.expiry + 1n }),
	).rejects.toThrow("terms differ");
	const now = terms.expiry - 1n;
	const create = await createDvpInstruction(terms, terms.seller);
	expect(create.accounts?.[1]?.address).toBe(trade);
	const fund = await fundDvpInstruction(account, terms, terms.seller, 9, now);
	expect(fund.accounts?.[2]?.address).toBe(result.assetEscrow);
	await expect(
		fundDvpInstruction(account, terms, terms.seller, 9, terms.expiry),
	).rejects.toThrow("expired");
	await expect(
		fundDvpInstruction(account, terms, terms.settlementAuthority, 9, now),
	).rejects.toThrow("not a party");
	const refund = await reclaimDvpInstruction(account, terms, terms.buyer);
	expect(refund.accounts?.[0]?.address).toBe(terms.buyer);
	expect(refund.accounts?.[3]?.address).toBe(result.quoteEscrow);
	const recovery = await recoverDvpInstruction(terms, terms.buyer);
	expect(recovery.accounts?.[4]?.address).toBe(result.quoteEscrow);

	const treasury = address("HLdg6LmRZi6Xfe5WgGLRPCXpr6auR1uodt4D3GotkhF8");
	const [settle, fee] = await settleDvpInstructions(
		account,
		terms,
		treasury,
		6,
		now,
	);
	expect(settle.accounts?.[0]?.address).toBe(terms.settlementAuthority);
	expect(fee.accounts?.[0]?.address).toBe(settle.accounts?.[6]?.address);
	expect(fee.accounts?.[3]?.address).toBe(terms.seller);
	expect(Buffer.from(fee.data ?? []).readBigUInt64LE(1)).toBe(1050n);
	bytes.set(encode(terms.settlementAuthority), 321);
	await expect(verifyDvpTrade(account, terms)).rejects.toThrow("terms differ");
});
