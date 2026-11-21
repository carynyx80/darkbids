import {
	AccountRole,
	type Address,
	address,
	getAddressEncoder,
	getProgramDerivedAddress,
	getU64Encoder,
	type Instruction,
} from "@solana/kit";
import bs58 from "bs58";
import { quoteFee } from "./fees";

export const DVP_PROGRAM = address(
	"dvp34bdbcEm4f4FCUjGV4mDAkDshaQR4LkK8fdcsyZq",
);
const ASSOCIATED_TOKEN_PROGRAM = address(
	"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const SWAP_DVP_SIZE = 458;
const encoder = new TextEncoder();

export interface DvpTerms {
	settlementAuthority: Address;
	seller: Address;
	buyer: Address;
	assetMint: Address;
	quoteMint: Address;
	assetTokenProgram: Address;
	quoteTokenProgram: Address;
	assetAmount: bigint;
	quoteAmount: bigint;
	expiry: bigint;
	nonce: bigint;
	reference: string;
}

export function deriveDvpTrade(terms: DvpTerms) {
	const encode = getAddressEncoder().encode;
	return getProgramDerivedAddress({
		programAddress: DVP_PROGRAM,
		seeds: [
			"dvp",
			encode(terms.settlementAuthority),
			encode(terms.seller),
			encode(terms.buyer),
			encode(terms.assetMint),
			encode(terms.quoteMint),
			getU64Encoder().encode(terms.nonce),
		],
	});
}

function deriveEscrow(trade: Address, mint: Address, tokenProgram: Address) {
	const encode = getAddressEncoder().encode;
	return getProgramDerivedAddress({
		programAddress: ASSOCIATED_TOKEN_PROGRAM,
		seeds: [encode(trade), encode(tokenProgram), encode(mint)],
	});
}

/** Match a mainnet account against the terms that the parties approved. */
export async function verifyDvpTrade(
	account: { address: Address; owner: Address; data: Uint8Array },
	terms: DvpTerms,
) {
	const [tradeAddress, bump] = await deriveDvpTrade(terms);
	if (
		account.address !== tradeAddress ||
		account.owner !== DVP_PROGRAM ||
		account.data.byteLength !== SWAP_DVP_SIZE ||
		account.data[0] !== bump
	)
		throw new Error("Invalid DvP trade account");

	// SwapDvp::LEN uses a packed field layout. Addresses are 32-byte
	// public keys and the four numeric fields are 64-bit little-endian.
	const data = account.data;
	const keyAt = (offset: number) =>
		bs58.encode(data.subarray(offset, offset + 32));
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const partiesAndMints = [
		terms.seller,
		terms.buyer,
		terms.assetMint,
		terms.quoteMint,
		terms.settlementAuthority,
		terms.assetTokenProgram,
		terms.quoteTokenProgram,
	];
	const reference = encoder.encode(terms.reference);
	if (
		partiesAndMints.some((key, index) => keyAt(1 + index * 32) !== key) ||
		view.getBigUint64(225, true) !== terms.assetAmount ||
		view.getBigUint64(233, true) !== terms.quoteAmount ||
		view.getBigInt64(241, true) !== terms.expiry ||
		view.getBigUint64(249, true) !== terms.nonce ||
		reference.length > 64 ||
		data
			.subarray(257, 321)
			.some((byte, index) => byte !== (reference[index] ?? 0)) ||
		keyAt(321) !== terms.seller ||
		keyAt(353) !== terms.buyer ||
		data[449] !== 0
	)
		throw new Error("On-chain DvP terms differ from the agreement");

	const [[assetEscrow], [quoteEscrow]] = await Promise.all([
		deriveEscrow(tradeAddress, terms.assetMint, terms.assetTokenProgram),
		deriveEscrow(tradeAddress, terms.quoteMint, terms.quoteTokenProgram),
	]);
	return { tradeAddress, assetEscrow, quoteEscrow };
}

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const SPL_TOKEN_PROGRAM = address(
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const { READONLY, READONLY_SIGNER, WRITABLE, WRITABLE_SIGNER } = AccountRole;

function dvpInstruction(
	data: Uint8Array,
	metas: Array<[Address, AccountRole]>,
): Instruction {
	return {
		programAddress: DVP_PROGRAM,
		data,
		accounts: metas.map(([address, role]) => ({ address, role })),
	};
}

function requireLegacySpl(terms: DvpTerms) {
	if (
		terms.assetTokenProgram !== SPL_TOKEN_PROGRAM ||
		terms.quoteTokenProgram !== SPL_TOKEN_PROGRAM
	)
		throw new Error(
			"Settlement currently supports the classic SPL Token Program",
		);
	if (
		terms.assetMint === terms.quoteMint ||
		new Set([terms.seller, terms.buyer, terms.settlementAuthority]).size !== 3
	)
		throw new Error(
			"DvP requires two distinct mints and three distinct wallet roles",
		);
}

export async function createDvpInstruction(terms: DvpTerms, payer: Address) {
	requireLegacySpl(terms);
	const maxU64 = (1n << 64n) - 1n;
	if (
		terms.assetAmount < 1n ||
		terms.assetAmount > maxU64 ||
		terms.quoteAmount < 1n ||
		terms.quoteAmount > maxU64 ||
		terms.expiry < 1n ||
		terms.expiry >= 1n << 63n ||
		terms.nonce < 0n ||
		terms.nonce > maxU64
	)
		throw new Error("DvP amounts, expiry, or nonce are out of range");
	const reference = encoder.encode(terms.reference);
	if (reference.length > 64) throw new Error("DvP reference exceeds 64 bytes");
	const [trade] = await deriveDvpTrade(terms);
	const [[tombstone], [assetEscrow], [quoteEscrow]] = await Promise.all([
		getProgramDerivedAddress({
			programAddress: DVP_PROGRAM,
			seeds: ["nonce", getAddressEncoder().encode(trade)],
		}),
		deriveEscrow(trade, terms.assetMint, SPL_TOKEN_PROGRAM),
		deriveEscrow(trade, terms.quoteMint, SPL_TOKEN_PROGRAM),
	]);

	// CreateDvp's trailing options leave both destinations at their party defaults
	// and allow settlement any time within the agreed expiry.
	const data = new Uint8Array(41 + reference.length);
	const view = new DataView(data.buffer);
	view.setBigUint64(1, terms.assetAmount, true);
	view.setBigUint64(9, terms.quoteAmount, true);
	view.setBigInt64(17, terms.expiry, true);
	view.setBigUint64(25, terms.nonce, true);
	data[33] = 1;
	view.setUint32(34, reference.length, true);
	data.set(reference, 38);

	return dvpInstruction(data, [
		[payer, WRITABLE_SIGNER],
		[trade, WRITABLE],
		[tombstone, WRITABLE],
		[terms.settlementAuthority, READONLY],
		[terms.seller, READONLY],
		[terms.buyer, READONLY],
		[terms.assetMint, READONLY],
		[terms.quoteMint, READONLY],
		[assetEscrow, WRITABLE],
		[quoteEscrow, WRITABLE],
		[SYSTEM_PROGRAM, READONLY],
		[SPL_TOKEN_PROGRAM, READONLY],
		[SPL_TOKEN_PROGRAM, READONLY],
		[ASSOCIATED_TOKEN_PROGRAM, READONLY],
	]);
}

type DvpAccount = Parameters<typeof verifyDvpTrade>[0];

function transferChecked(
	source: Address,
	mint: Address,
	target: Address,
	owner: Address,
	amount: bigint,
	decimals: number,
): Instruction {
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
		throw new Error("Invalid token precision");
	if (amount < 1n || amount >= 1n << 64n)
		throw new Error("Token transfer amount is out of range");
	const data = new Uint8Array(10);
	data[0] = 12;
	new DataView(data.buffer).setBigUint64(1, amount, true);
	data[9] = decimals;
	return {
		programAddress: SPL_TOKEN_PROGRAM,
		data,
		accounts: [
			{ address: source, role: WRITABLE },
			{ address: mint, role: READONLY },
			{ address: target, role: WRITABLE },
			{ address: owner, role: READONLY_SIGNER },
		],
	};
}

function partyLeg(terms: DvpTerms, wallet: Address) {
	if (wallet === terms.seller)
		return { mint: terms.assetMint, amount: terms.assetAmount };
	if (wallet === terms.buyer)
		return { mint: terms.quoteMint, amount: terms.quoteAmount };
	throw new Error("Wallet is not a party to this deal");
}

export async function fundDvpInstruction(
	account: DvpAccount,
	terms: DvpTerms,
	wallet: Address,
	decimals: number,
	now: bigint,
) {
	requireLegacySpl(terms);
	if (now >= terms.expiry) throw new Error("Deal has expired");
	const { assetEscrow, quoteEscrow } = await verifyDvpTrade(account, terms);
	const { mint, amount } = partyLeg(terms, wallet);
	const [source] = await deriveEscrow(wallet, mint, SPL_TOKEN_PROGRAM);
	return transferChecked(
		source,
		mint,
		wallet === terms.seller ? assetEscrow : quoteEscrow,
		wallet,
		amount,
		decimals,
	);
}

export async function reclaimDvpInstruction(
	account: DvpAccount,
	terms: DvpTerms,
	wallet: Address,
) {
	requireLegacySpl(terms);
	const { tradeAddress, assetEscrow, quoteEscrow } = await verifyDvpTrade(
		account,
		terms,
	);
	const { mint } = partyLeg(terms, wallet);
	const [destination] = await deriveEscrow(wallet, mint, SPL_TOKEN_PROGRAM);
	return dvpInstruction(Uint8Array.of(1), [
		[wallet, READONLY_SIGNER],
		[tradeAddress, READONLY],
		[mint, READONLY],
		[wallet === terms.seller ? assetEscrow : quoteEscrow, WRITABLE],
		[destination, WRITABLE],
		[SPL_TOKEN_PROGRAM, READONLY],
		[MEMO_PROGRAM, READONLY],
	]);
}

export async function settleDvpInstructions(
	account: DvpAccount,
	terms: DvpTerms,
	treasury: Address,
	quoteDecimals: number,
	now: bigint,
) {
	requireLegacySpl(terms);
	if (now >= terms.expiry) throw new Error("Deal has expired");
	if (treasury === terms.seller || treasury === terms.buyer)
		throw new Error("Treasury must be distinct from the trading parties");
	const { tradeAddress, assetEscrow, quoteEscrow } = await verifyDvpTrade(
		account,
		terms,
	);
	const [
		[sellerQuote],
		[buyerAsset],
		[sellerAsset],
		[buyerQuote],
		[treasuryQuote],
	] = await Promise.all([
		deriveEscrow(terms.seller, terms.quoteMint, SPL_TOKEN_PROGRAM),
		deriveEscrow(terms.buyer, terms.assetMint, SPL_TOKEN_PROGRAM),
		deriveEscrow(terms.seller, terms.assetMint, SPL_TOKEN_PROGRAM),
		deriveEscrow(terms.buyer, terms.quoteMint, SPL_TOKEN_PROGRAM),
		deriveEscrow(treasury, terms.quoteMint, SPL_TOKEN_PROGRAM),
	]);
	const fee = quoteFee(terms.quoteAmount);
	if (fee >= terms.quoteAmount)
		throw new Error("Quote must exceed the settlement fee");

	// In the same transaction, the seller authorizes paying the fee from
	// the quote proceeds after the DvP instruction credits their account.
	return [
		dvpInstruction(Uint8Array.of(2, 0), [
			[terms.settlementAuthority, WRITABLE_SIGNER],
			[tradeAddress, WRITABLE],
			[terms.assetMint, READONLY],
			[terms.quoteMint, READONLY],
			[assetEscrow, WRITABLE],
			[quoteEscrow, WRITABLE],
			[sellerQuote, WRITABLE],
			[buyerAsset, WRITABLE],
			[sellerAsset, WRITABLE],
			[buyerQuote, WRITABLE],
			[SPL_TOKEN_PROGRAM, READONLY],
			[SPL_TOKEN_PROGRAM, READONLY],
			[MEMO_PROGRAM, READONLY],
		]),
		transferChecked(
			sellerQuote,
			terms.quoteMint,
			treasuryQuote,
			terms.seller,
			fee,
			quoteDecimals,
		),
	] as const;
}

export async function recoverDvpInstruction(terms: DvpTerms, wallet: Address) {
	requireLegacySpl(terms);
	const { mint } = partyLeg(terms, wallet);
	const [trade] = await deriveDvpTrade(terms);
	const encode = getAddressEncoder().encode;
	const [[tombstone], [escrow], [destination]] = await Promise.all([
		getProgramDerivedAddress({
			programAddress: DVP_PROGRAM,
			seeds: ["nonce", encode(trade)],
		}),
		deriveEscrow(trade, mint, SPL_TOKEN_PROGRAM),
		deriveEscrow(wallet, mint, SPL_TOKEN_PROGRAM),
	]);
	const seeds = [
		terms.settlementAuthority,
		terms.seller,
		terms.buyer,
		terms.assetMint,
		terms.quoteMint,
	];
	const data = new Uint8Array(1 + 5 * 32 + 8);
	data[0] = 5;
	for (const [index, seed] of seeds.entries())
		data.set(encode(seed), 1 + index * 32);
	data.set(getU64Encoder().encode(terms.nonce), 161);
	return dvpInstruction(data, [
		[wallet, WRITABLE_SIGNER],
		[trade, READONLY],
		[tombstone, READONLY],
		[mint, READONLY],
		[escrow, WRITABLE],
		[destination, WRITABLE],
		[SPL_TOKEN_PROGRAM, READONLY],
		[MEMO_PROGRAM, READONLY],
	]);
}
