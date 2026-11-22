import { randomBytes, randomUUID } from "node:crypto";
import {
	AccountRole,
	type Address,
	address,
	appendTransactionMessageInstructions,
	assertIsFullySignedTransaction,
	compileTransaction,
	createKeyPairSignerFromPrivateKeyBytes,
	createSolanaRpc,
	createTransactionMessage,
	getAddressEncoder,
	getBase64EncodedWireTransaction,
	getProgramDerivedAddress,
	getSignatureFromTransaction,
	getTransactionDecoder,
	type Instruction,
	partiallySignTransaction,
	setTransactionMessageConfig,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { SOL_MINT } from "@veil/core/config";
import {
	createDvpInstruction,
	DVP_PROGRAM,
	type DvpTerms,
	deriveDvpTrade,
	deriveEscrow,
	fundDvpInstruction,
	reclaimDvpInstruction,
	recoverDvpInstruction,
	SPL_TOKEN_PROGRAM,
	settleDvpInstructions,
	verifyDvpTrade,
} from "@veil/core/dvp";
import { parseUnits } from "@veil/core/fees";
import {
	treasuryApprovalMessage,
	validWalletSignature,
} from "@veil/core/otc-workflows";
import {
	settlementApprovalMessage,
	settlementOpeningInput,
	verifySettlementOpening,
} from "@veil/core/settlement-approval";
import bs58 from "bs58";
import type { Pool } from "pg";
import nacl from "tweetnacl";
import { z } from "zod";
import {
	isPilotDeal,
	isPilotTrade,
	type pilotWallets,
	USDC_MINT,
} from "./otc-pilot";

export const dvpAction = z.enum(["create", "fund", "settle", "refund"]);
export const dvpPrepare = z.strictObject({
	opening: settlementOpeningInput.optional(),
});
export const dvpSubmit = z.strictObject({
	id: z.uuid(),
	wire: z.base64().min(4).max(5464),
});

export class DvpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

const USDC = address(USDC_MINT);
const WSOL = address(SOL_MINT);
const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM = address("11111111111111111111111111111111");
const { READONLY, WRITABLE, WRITABLE_SIGNER } = AccountRole;

type StoredTerms = Omit<
	DvpTerms,
	"assetAmount" | "quoteAmount" | "expiry" | "nonce"
> & {
	assetAmount: string;
	quoteAmount: string;
	expiry: string;
	nonce: string;
};
type Trade = {
	terms: StoredTerms;
	asset_decimals: number;
	quote_decimals: number;
	treasury: Address;
};
type Deal = {
	seller: string;
	buyer: string;
	expires_at: Date;
	cancelled: boolean;
	accepted_at: Date | null;
};
type Plan = {
	id: string;
	action: z.infer<typeof dvpAction>;
	wire: string;
	last_valid_block_height: string;
	signature: string | null;
};

function restore({ terms }: Trade): DvpTerms {
	return {
		...terms,
		assetAmount: BigInt(terms.assetAmount),
		quoteAmount: BigInt(terms.quoteAmount),
		expiry: BigInt(terms.expiry),
		nonce: BigInt(terms.nonce),
	};
}

async function createAta(
	payer: Address,
	owner: Address,
	mint: Address,
): Promise<Instruction> {
	const [ata] = await deriveEscrow(owner, mint, SPL_TOKEN_PROGRAM);
	return {
		programAddress: ATA_PROGRAM,
		data: Uint8Array.of(1),
		accounts: [
			{ address: payer, role: WRITABLE_SIGNER },
			{ address: ata, role: WRITABLE },
			{ address: owner, role: READONLY },
			{ address: mint, role: READONLY },
			{ address: SYSTEM, role: READONLY },
			{ address: SPL_TOKEN_PROGRAM, role: READONLY },
		],
	};
}

function wrapSol(wallet: Address, ata: Address, amount: bigint): Instruction[] {
	if (amount <= 0n) return [];
	const data = Buffer.alloc(12);
	data.writeUInt32LE(2);
	data.writeBigUInt64LE(amount, 4);
	return [
		{
			programAddress: SYSTEM,
			data,
			accounts: [
				{ address: wallet, role: WRITABLE_SIGNER },
				{ address: ata, role: WRITABLE },
			],
		},
		{
			programAddress: SPL_TOKEN_PROGRAM,
			data: Uint8Array.of(17),
			accounts: [{ address: ata, role: WRITABLE }],
		},
	];
}

export async function createDvpService(
	pool: Pool,
	rpcKey: string,
	authoritySeed: string,
	treasury: Address,
	screen: (wallet: string) => Promise<void>,
	pilot?: z.infer<typeof pilotWallets>,
) {
	const endpoint = new URL("https://mainnet.helius-rpc.com");
	endpoint.searchParams.set("api-key", rpcKey);
	const rpc = createSolanaRpc(endpoint.href);
	const secret = Buffer.from(authoritySeed, "base64");
	if (secret.length !== 32)
		throw new Error("Settlement signer must contain a 32-byte seed");
	const authority = await createKeyPairSignerFromPrivateKeyBytes(secret);
	secret.fill(0);
	if (
		pilot?.some((wallet) => wallet === treasury || wallet === authority.address)
	)
		throw new Error(
			"Pilot wallets must be separate from the treasury and authority",
		);
	if (authority.address === treasury)
		throw new Error("Settlement signer must be separate from the treasury");

	async function mainnetAccount(account: Address) {
		const { value } = await rpc
			.getAccountInfo(account, { encoding: "base64", commitment: "confirmed" })
			.send({ abortSignal: AbortSignal.timeout(10000) });
		return value
			? {
					address: account,
					owner: value.owner,
					data: Buffer.from(value.data[0], "base64"),
				}
			: null;
	}

	async function tokenBalance(account: Address, mint: Address, owner: Address) {
		const info = await mainnetAccount(account);
		if (!info) return 0n;
		// A prefunded, uninitialized PDA still has a system-owned empty account.
		if (info.owner === SYSTEM && info.data.length === 0) return 0n;
		if (
			info.owner !== SPL_TOKEN_PROGRAM ||
			info.data.length !== 165 ||
			bs58.encode(info.data.subarray(0, 32)) !== mint ||
			bs58.encode(info.data.subarray(32, 64)) !== owner ||
			info.data[108] !== 1
		)
			throw new DvpError(409, "A required token account is invalid or frozen");
		return info.data.readBigUInt64LE(64);
	}

	async function dealFor(id: string, wallet: string) {
		const query = await pool.query<Deal>(
			`SELECT l.seller,o.buyer,l.expires_at,l.cancelled,o.accepted_at
			FROM offer o JOIN listing l ON l.id=o.listing_id
			WHERE o.id=$1 AND (l.seller=$2 OR o.buyer=$2)`,
			[id, wallet],
		);
		if (!query.rows[0]) throw new DvpError(404, "Deal unavailable");
		return query.rows[0];
	}

	async function storedTrade(id: string) {
		return (
			await pool.query<Trade>(
				"SELECT terms,asset_decimals,quote_decimals,treasury FROM settlement_dvp WHERE offer_id=$1",
				[id],
			)
		).rows[0];
	}

	async function initialize(
		id: string,
		deal: Deal,
		opening: z.infer<typeof settlementOpeningInput> | undefined,
	) {
		if (!opening)
			throw new DvpError(400, "Decrypt and review the signed terms first");
		const approved = await verifySettlementOpening(id, treasury, opening).catch(
			() => {
				throw new DvpError(400, "Invalid settlement terms");
			},
		);
		const { rows } = await pool.query<{
			wallet: string;
			commitment: string;
			signature: string;
		}>(
			"SELECT wallet,commitment,signature FROM settlement_approval WHERE offer_id=$1 AND wallet IN ($2,$3)",
			[id, deal.seller, deal.buyer],
		);
		const message = settlementApprovalMessage(
			{
				id,
				seller: deal.seller,
				buyer: deal.buyer,
				expiresAt: deal.expires_at.toISOString(),
			},
			treasury,
			approved.commitment,
		);
		if (
			rows.length !== 2 ||
			rows.some(
				(row) =>
					row.commitment !== approved.commitment ||
					!nacl.sign.detached.verify(
						message,
						Buffer.from(row.signature, "base64"),
						bs58.decode(row.wallet),
					),
			)
		)
			throw new DvpError(
				409,
				"Both wallets must sign these exact settlement terms",
			);
		const { rows: policies } = await pool.query<{
			wallet: string;
			approver: string;
			sol_threshold: string;
			usdc_threshold: string;
			approved_commitment: string | null;
			approval_signature: string | null;
		}>("SELECT * FROM otc_deal_policy WHERE offer_id=$1", [id]);
		for (const policy of policies) {
			const limit = BigInt(
				opening.terms.quote === "SOL"
					? policy.sol_threshold
					: policy.usdc_threshold,
			);
			if (
				approved.quoteAmount > limit &&
				(policy.approved_commitment !== approved.commitment ||
					!policy.approval_signature ||
					!validWalletSignature(
						policy.approver,
						policy.approval_signature,
						treasuryApprovalMessage(id, policy.wallet, approved.commitment),
					))
			)
				throw new DvpError(
					409,
					"A treasury approver must sign these terms before escrow can be created",
				);
		}
		const assetMint = address(opening.terms.mint);
		const quoteMint = opening.terms.quote === "USDC" ? USDC : WSOL;
		if (assetMint === quoteMint)
			throw new DvpError(400, "Choose two different assets");
		if (
			[deal.seller, deal.buyer].includes(treasury) ||
			[deal.seller, deal.buyer].includes(authority.address)
		)
			throw new DvpError(
				400,
				"Treasury and settlement signer cannot be trading parties",
			);
		const mint = await mainnetAccount(assetMint);
		if (
			!mint ||
			mint.owner !== SPL_TOKEN_PROGRAM ||
			mint.data.length !== 82 ||
			mint.data[45] !== 1
		)
			throw new DvpError(400, "This trade requires a classic SPL token mint");
		let amount: bigint;
		try {
			amount = parseUnits(opening.terms.size, mint.data[44]);
		} catch {
			throw new DvpError(
				400,
				"Asset quantity does not match the mint precision",
			);
		}
		enforcePilotTrade({
			...deal,
			assetMint,
			quoteMint,
			assetAmount: amount,
			quoteAmount: approved.quoteAmount,
		});
		const terms: StoredTerms = {
			seller: address(deal.seller),
			buyer: address(deal.buyer),
			settlementAuthority: authority.address,
			assetMint,
			quoteMint,
			assetTokenProgram: SPL_TOKEN_PROGRAM,
			quoteTokenProgram: SPL_TOKEN_PROGRAM,
			assetAmount: amount.toString(),
			quoteAmount: approved.quoteAmount.toString(),
			expiry: Math.floor(deal.expires_at.getTime() / 1000).toString(),
			nonce: randomBytes(8).readBigUInt64LE().toString(),
			reference: id,
		};
		await pool.query(
			`INSERT INTO settlement_dvp (offer_id,terms,asset_decimals,quote_decimals,treasury)
			VALUES ($1,$2,$3,$4,$5) ON CONFLICT (offer_id) DO NOTHING`,
			[
				id,
				JSON.stringify(terms),
				mint.data[44],
				approved.quoteDecimals,
				treasury,
			],
		);
		const stored = await storedTrade(id);
		if (!stored) throw new DvpError(503, "Escrow terms could not be saved");
		return stored;
	}

	async function escrowState(terms: DvpTerms, refundWallet?: Address) {
		const [trade] = await deriveDvpTrade(terms);
		const record = await mainnetAccount(trade);
		const verified =
			record?.owner === DVP_PROGRAM
				? await verifyDvpTrade(record, terms)
				: null;
		if (
			record &&
			!verified &&
			(record.owner !== SYSTEM || record.data.length !== 0)
		)
			throw new DvpError(409, "The on-chain trade record is invalid");
		const [tombstone] = await getProgramDerivedAddress({
			programAddress: DVP_PROGRAM,
			seeds: ["nonce", getAddressEncoder().encode(trade)],
		});
		const closed =
			!verified && (await mainnetAccount(tombstone))?.owner === DVP_PROGRAM;
		const [[assetEscrow], [quoteEscrow]] = await Promise.all([
			deriveEscrow(trade, terms.assetMint, SPL_TOKEN_PROGRAM),
			deriveEscrow(trade, terms.quoteMint, SPL_TOKEN_PROGRAM),
		]);
		const readLeg = (account: Address, mint: Address, party: Address) =>
			refundWallet && refundWallet !== party
				? 0n
				: tokenBalance(account, mint, trade);
		const [assetBalance, quoteBalance] = await Promise.all([
			readLeg(assetEscrow, terms.assetMint, terms.seller),
			readLeg(quoteEscrow, terms.quoteMint, terms.buyer),
		]);
		return {
			trade,
			record: verified ? record : null,
			closed,
			assetBalance,
			quoteBalance,
		};
	}

	function enforcePilotTrade(trade: Parameters<typeof isPilotTrade>[1]) {
		if (!isPilotTrade(pilot, trade))
			throw new DvpError(
				403,
				"Pilot trades are limited to 1 USDC against 0.01 SOL",
			);
	}

	function enforcePilotDeal(deal: Deal) {
		if (!isPilotDeal(pilot, deal))
			throw new DvpError(403, "This deal is outside the OTC pilot");
	}

	function enforceActive(deal: Deal) {
		if (
			!deal.accepted_at ||
			deal.cancelled ||
			deal.expires_at.getTime() <= Date.now()
		)
			throw new DvpError(409, "The accepted deal has expired or was canceled");
	}

	return {
		async status(id: string, wallet: string) {
			await dealFor(id, wallet);
			const stored = await storedTrade(id);
			if (!stored) return { state: "not-created" as const };
			const terms = restore(stored);
			const state = await escrowState(terms).catch(async (error) => {
				if (!(error instanceof DvpError)) throw error;
				return escrowState(terms, address(wallet));
			});
			return {
				state: state.closed
					? ("closed" as const)
					: state.record
						? ("open" as const)
						: ("not-created" as const),
				trade: state.trade,
				sellerFunded: state.assetBalance >= terms.assetAmount,
				buyerFunded: state.quoteBalance >= terms.quoteAmount,
				canRefund:
					wallet === terms.seller
						? state.assetBalance > 0n
						: state.quoteBalance > 0n,
			};
		},

		async confirmedReceipt(id: string, wallet: string) {
			await dealFor(id, wallet);
			const { rows } = await pool.query<{
				signature: ReturnType<typeof getSignatureFromTransaction>;
				confirmed_at: Date | null;
			}>(
				`SELECT signature,confirmed_at FROM settlement_transaction WHERE offer_id=$1
				 AND action='settle' AND signature IS NOT NULL
				 ORDER BY confirmed_at DESC NULLS LAST, last_valid_block_height DESC LIMIT 20`,
				[id],
			);
			if (!rows.length) return { signature: null };
			if (rows[0].confirmed_at) return { signature: rows[0].signature };
			const result = await rpc
				.getSignatureStatuses(
					rows.map((row) => row.signature),
					{ searchTransactionHistory: true },
				)
				.send({ abortSignal: AbortSignal.timeout(10000) });
			const confirmed = result.value.findIndex(
				(status) => status?.confirmationStatus === "finalized" && !status.err,
			);
			if (confirmed === -1) return { signature: null };
			const signature = rows[confirmed].signature;
			await pool.query(
				"UPDATE settlement_transaction SET confirmed_at=now() WHERE offer_id=$1 AND action='settle' AND signature=$2",
				[id, signature],
			);
			return { signature };
		},

		async prepare(
			id: string,
			wallet: Address,
			action: z.infer<typeof dvpAction>,
			input: z.infer<typeof dvpPrepare>,
		) {
			const deal = await dealFor(id, wallet);
			if (action !== "refund") {
				enforcePilotDeal(deal);
				enforceActive(deal);
				await Promise.all([screen(deal.seller), screen(deal.buyer)]);
			}
			if (action === "settle" && wallet !== deal.seller)
				throw new DvpError(403, "Only the seller can sign the treasury fee");
			const stored =
				(await storedTrade(id)) ??
				(action === "create"
					? await initialize(id, deal, input.opening)
					: null);
			if (!stored) throw new DvpError(409, "Create the on-chain escrow first");
			const terms = restore(stored);
			if (action !== "refund") enforcePilotTrade(terms);
			const current = await escrowState(
				terms,
				action === "refund" ? wallet : undefined,
			);
			const now = BigInt(Math.floor(Date.now() / 1000));
			const assetLeg = wallet === terms.seller;
			const mint = assetLeg ? terms.assetMint : terms.quoteMint;
			const target = assetLeg ? terms.assetAmount : terms.quoteAmount;
			const credited = assetLeg ? current.assetBalance : current.quoteBalance;
			const precision = assetLeg
				? stored.asset_decimals
				: stored.quote_decimals;
			const instructions: Instruction[] = [];
			switch (action) {
				case "create":
					if (current.record || current.closed)
						throw new DvpError(409, "Escrow already exists");
					instructions.push(await createDvpInstruction(terms, wallet));
					break;
				case "fund": {
					if (!current.record) throw new DvpError(409, "Escrow is not open");
					if (credited >= target)
						throw new DvpError(409, "Your side is already funded");
					const [source] = await deriveEscrow(wallet, mint, SPL_TOKEN_PROGRAM);
					const balance = await tokenBalance(source, mint, wallet);
					if (mint === WSOL && balance < target - credited) {
						instructions.push(
							await createAta(wallet, wallet, mint),
							...wrapSol(wallet, source, target - credited - balance),
						);
					} else if (balance < target - credited) {
						throw new DvpError(
							409,
							"Insufficient balance in your public token account",
						);
					}
					instructions.push(
						await fundDvpInstruction(
							current.record,
							terms,
							wallet,
							precision,
							now,
							credited,
						),
					);
					break;
				}
				case "settle": {
					if (
						!current.record ||
						current.assetBalance < terms.assetAmount ||
						current.quoteBalance < terms.quoteAmount
					)
						throw new DvpError(409, "Both sides must fund the open escrow");
					if (authority.address !== terms.settlementAuthority)
						throw new DvpError(
							503,
							"The original settlement signer is unavailable",
						);
					instructions.push(
						...(await Promise.all([
							createAta(wallet, terms.seller, terms.quoteMint),
							createAta(wallet, terms.buyer, terms.assetMint),
							createAta(wallet, terms.seller, terms.assetMint),
							createAta(wallet, terms.buyer, terms.quoteMint),
							createAta(wallet, stored.treasury, terms.quoteMint),
						])),
					);
					instructions.push(
						...(await settleDvpInstructions(
							current.record,
							terms,
							stored.treasury,
							stored.quote_decimals,
							now,
						)),
					);
					break;
				}
				case "refund":
					if (!credited || (!current.record && !current.closed))
						throw new DvpError(
							409,
							"There are no funds to recover for this wallet",
						);
					instructions.push(await createAta(wallet, wallet, mint));
					instructions.push(
						current.record
							? await reclaimDvpInstruction(current.record, terms, wallet)
							: await recoverDvpInstruction(terms, wallet),
					);
					break;
			}
			const { value: block } = await rpc
				.getLatestBlockhash({ commitment: "confirmed" })
				.send({ abortSignal: AbortSignal.timeout(10000) });
			const height = await rpc
				.getBlockHeight({ commitment: "confirmed" })
				.send({ abortSignal: AbortSignal.timeout(10000) });
			const client = await pool.connect();
			try {
				await client.query("BEGIN");
				await client.query(
					"SELECT offer_id FROM settlement_dvp WHERE offer_id=$1 FOR UPDATE",
					[id],
				);
				const { rows } = await client.query<Plan>(
					`SELECT id,action,wire,last_valid_block_height,signature FROM settlement_transaction
					WHERE offer_id=$1 AND wallet=$2 AND action=$3 AND last_valid_block_height >= $4
					ORDER BY last_valid_block_height DESC LIMIT 1`,
					[id, wallet, action, height.toString()],
				);
				if (rows[0]) {
					await client.query("COMMIT");
					return {
						id: rows[0].id,
						wire: rows[0].wire,
						signature: rows[0].signature,
					};
				}
				const message = setTransactionMessageConfig(
					{
						computeUnitLimit: 500_000,
						loadedAccountsDataSizeLimit: 67_108_864,
					},
					createTransactionMessage({ version: 1 }),
				);
				const tx = compileTransaction(
					appendTransactionMessageInstructions(
						instructions,
						setTransactionMessageLifetimeUsingBlockhash(
							block,
							setTransactionMessageFeePayer(wallet, message),
						),
					),
				);
				const plan = {
					id: randomUUID(),
					wire: getBase64EncodedWireTransaction(tx),
					signature: null,
				};
				await client.query(
					`INSERT INTO settlement_transaction (id,offer_id,wallet,action,wire,last_valid_block_height)
					VALUES ($1,$2,$3,$4,$5,$6)`,
					[
						plan.id,
						id,
						wallet,
						action,
						plan.wire,
						block.lastValidBlockHeight.toString(),
					],
				);
				await client.query("COMMIT");
				return plan;
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			} finally {
				client.release();
			}
		},

		async submit(
			id: string,
			wallet: Address,
			input: z.infer<typeof dvpSubmit>,
			fundingEnabled: boolean,
		) {
			const deal = await dealFor(id, wallet);
			const { rows } = await pool.query<Plan>(
				"SELECT id,action,wire,last_valid_block_height,signature FROM settlement_transaction WHERE id=$1 AND offer_id=$2 AND wallet=$3",
				[input.id, id, wallet],
			);
			const plan = rows[0];
			if (!plan) throw new DvpError(404, "Transaction request unavailable");
			if (plan.action !== "refund") {
				if (!fundingEnabled)
					throw new DvpError(503, "New OTC transactions are paused");
				enforcePilotDeal(deal);
				enforceActive(deal);
				const stored = await storedTrade(id);
				if (!stored) throw new DvpError(409, "Escrow is unavailable");
				enforcePilotTrade(restore(stored));
				await Promise.all([screen(deal.seller), screen(deal.buyer)]);
			}
			const decode = getTransactionDecoder();
			const unsigned = decode.decode(Buffer.from(plan.wire, "base64"));
			let signed: ReturnType<typeof decode.decode>;
			try {
				signed = decode.decode(Buffer.from(input.wire, "base64"));
			} catch {
				throw new DvpError(400, "Invalid signed transaction");
			}
			if (
				!Buffer.from(unsigned.messageBytes).equals(
					Buffer.from(signed.messageBytes),
				)
			)
				throw new DvpError(400, "Wallet changed the prepared transaction");
			const payerSignature = signed.signatures[wallet];
			if (
				!payerSignature ||
				!nacl.sign.detached.verify(
					Uint8Array.from(unsigned.messageBytes),
					Uint8Array.from(payerSignature),
					bs58.decode(wallet),
				)
			)
				throw new DvpError(
					401,
					"The session wallet must sign this transaction",
				);
			const signedByWallet = {
				...unsigned,
				signatures: { ...unsigned.signatures, [wallet]: payerSignature },
			};
			const full =
				plan.action === "settle"
					? await partiallySignTransaction([authority.keyPair], signedByWallet)
					: signedByWallet;
			assertIsFullySignedTransaction(full);
			const signature = getSignatureFromTransaction(full);
			if (plan.signature && plan.signature !== signature)
				throw new DvpError(409, "This transaction was already submitted");
			const reserved = await pool.query(
				"UPDATE settlement_transaction SET signature=$2 WHERE id=$1 AND (signature IS NULL OR signature=$2)",
				[plan.id, signature],
			);
			if (!reserved.rowCount)
				throw new DvpError(409, "This transaction was already submitted");
			try {
				const accepted = await rpc
					.sendTransaction(getBase64EncodedWireTransaction(full), {
						encoding: "base64",
						preflightCommitment: "confirmed",
					})
					.send({ abortSignal: AbortSignal.timeout(15000) });
				if (accepted !== signature)
					throw new Error("RPC returned a different signature");
			} catch {
				const status = await rpc
					.getSignatureStatuses([signature], { searchTransactionHistory: true })
					.send({ abortSignal: AbortSignal.timeout(10000) })
					.catch(() => null);
				if (!status?.value[0] || status.value[0].err)
					throw new DvpError(
						502,
						`Transaction was not confirmed. Check ${signature} before retrying.`,
					);
			}
			return { signature };
		},
	};
}
