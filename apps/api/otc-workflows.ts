import { encryptionKey, envelope, walletAddress } from "@veil/core/contracts";
import {
	termsCommitment,
	threshold,
	treasuryApprovalMessage,
	validWalletSignature,
	walletSignature,
} from "@veil/core/otc-workflows";
import { settlementApprovalMessage } from "@veil/core/settlement-approval";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

const idParams = z.object({ id: z.uuid() });
const createRfq = z.strictObject({
	id: z.uuid(),
	expiresAt: z.iso.datetime(),
	sellerKey: encryptionKey,
	invites: z
		.array(
			z.strictObject({
				dealer: walletAddress,
				dealerKey: encryptionKey,
				requestCopy: envelope,
				sellerCopy: envelope,
			}),
		)
		.min(1)
		.max(5),
});
const quoteInput = z.strictObject({
	id: z.uuid(),
	expiresAt: z.iso.datetime(),
	commitment: termsCommitment,
	signature: walletSignature,
	sellerTerms: envelope,
	dealerTerms: envelope,
});
type Invite = {
	seller: string;
	dealer: string;
	treasury: string;
	winning_deal: string | null;
	rfq_expiry: Date;
	seller_key: string;
	dealer_key: string;
	quote_id: string | null;
	quote_expires_at: Date | null;
	commitment: string;
	signature: string;
	seller_terms: string;
	dealer_terms: string;
};
type Options = {
	pool: Pool;
	walletOf(request: FastifyRequest): Promise<string>;
	screen(wallet: string): Promise<void>;
	Rejection: new (status: number, message: string) => Error;
	treasury?: string;
};

async function transaction<T>(
	pool: Pool,
	run: (client: PoolClient) => Promise<T>,
) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const result = await run(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

export function registerOtcWorkflows(
	api: FastifyInstance,
	{ pool, walletOf, screen, Rejection, treasury }: Options,
) {
	const idOf = (request: FastifyRequest) => idParams.parse(request.params).id;
	api.addHook("onSend", async (request, reply) => {
		if (/^\/(otc|deals)\//.test(request.url))
			reply.header("Cache-Control", "no-store");
	});

	api.post("/otc/contact", async (request) => {
		const wallet = await walletOf(request);
		const { key } = z.strictObject({ key: encryptionKey }).parse(request.body);
		const { rowCount } = await pool.query(
			`INSERT INTO otc_contact VALUES ($1,$2) ON CONFLICT (wallet) DO UPDATE
			  SET encryption_key=excluded.encryption_key WHERE otc_contact.encryption_key=excluded.encryption_key`,
			[wallet, key],
		);
		if (!rowCount)
			throw new Rejection(
				409,
				"This wallet already registered a different encryption key",
			);
		return { registered: true };
	});

	api.get("/otc/contact/:wallet", async (request) => {
		await walletOf(request);
		const { wallet } = z
			.object({ wallet: walletAddress })
			.parse(request.params);
		const { rows } = await pool.query(
			"SELECT encryption_key FROM otc_contact WHERE wallet=$1",
			[wallet],
		);
		if (!rows[0])
			throw new Rejection(
				404,
				"Ask this wallet to register in the quote room first",
			);
		return rows[0];
	});

	api.get("/otc/rfqs", async (request) => {
		const wallet = await walletOf(request);
		const { rows } = await pool.query(
			`SELECT r.id, r.seller, r.treasury, r.expires_at, r.winning_deal,
			 i.dealer, i.seller_key, i.dealer_key, i.quote_id, i.quote_expires_at, i.commitment, i.signature,
			 CASE WHEN r.seller=$1 THEN i.seller_copy ELSE i.request_copy END AS request_copy,
			 CASE WHEN r.seller=$1 THEN i.seller_terms ELSE i.dealer_terms END AS quote_copy
			 FROM otc_rfq r JOIN otc_rfq_invite i ON i.rfq_id=r.id
			 WHERE r.id IN (
			   SELECT mine.id FROM otc_rfq mine WHERE mine.seller=$1 OR EXISTS
			     (SELECT 1 FROM otc_rfq_invite invited WHERE invited.rfq_id=mine.id AND invited.dealer=$1)
			   ORDER BY mine.created_at DESC, mine.id DESC LIMIT 20
			 ) AND (r.seller=$1 OR i.dealer=$1)
			 ORDER BY r.created_at DESC, r.id, i.dealer`,
			[wallet],
		);
		return {
			rows: rows.map((row) => ({
				...row,
				winning_deal:
					row.seller === wallet || row.quote_id === row.winning_deal
						? row.winning_deal
						: null,
				closed: Boolean(row.winning_deal),
			})),
		};
	});

	api.post("/otc/rfqs", async (request) => {
		const seller = await walletOf(request);
		const input = createRfq.parse(request.body);
		const lifetime = Date.parse(input.expiresAt) - Date.now();
		const dealers = input.invites.map(({ dealer }) => dealer);
		if (!treasury)
			throw new Rejection(503, "Settlement treasury is unavailable");
		if (
			lifetime < 60_000 ||
			lifetime > 7 * 86400_000 ||
			dealers.includes(seller) ||
			dealers.includes(treasury) ||
			seller === treasury ||
			new Set(dealers).size !== dealers.length
		)
			throw new Rejection(
				400,
				"Choose distinct dealer wallets and a request deadline within seven days",
			);
		await Promise.all([seller, ...dealers].map(screen));
		await transaction(pool, async (client) => {
			const { rows } = await client.query<{
				wallet: string;
				encryption_key: string;
			}>(
				"SELECT wallet,encryption_key FROM otc_contact WHERE wallet=ANY($1::text[])",
				[[seller, ...dealers]],
			);
			const keys = new Map(rows.map((row) => [row.wallet, row.encryption_key]));
			if (
				keys.get(seller) !== input.sellerKey ||
				input.invites.some(
					(invite) => keys.get(invite.dealer) !== invite.dealerKey,
				)
			)
				throw new Rejection(
					409,
					"Trading wallets must register their encryption keys first",
				);
			const inserted = await client.query(
				"INSERT INTO otc_rfq (id,seller,expires_at,treasury) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
				[input.id, seller, input.expiresAt, treasury],
			);
			if (!inserted.rowCount)
				throw new Rejection(409, "This request already exists");
			for (const invite of input.invites)
				await client.query(
					"INSERT INTO otc_rfq_invite (rfq_id,dealer,seller_key,dealer_key,request_copy,seller_copy) VALUES ($1,$2,$3,$4,$5,$6)",
					[
						input.id,
						invite.dealer,
						input.sellerKey,
						invite.dealerKey,
						invite.requestCopy,
						invite.sellerCopy,
					],
				);
		});
		return { id: input.id };
	});

	api.post("/otc/rfqs/:id/quote", async (request) => {
		const dealer = await walletOf(request);
		const id = idOf(request);
		const input = quoteInput.parse(request.body);
		await screen(dealer);
		await transaction(pool, async (client) => {
			const {
				rows: [invite],
			} = await client.query<Invite>(
				`SELECT r.seller,r.treasury,r.winning_deal,r.expires_at AS rfq_expiry,i.quote_id
				 FROM otc_rfq r JOIN otc_rfq_invite i ON i.rfq_id=r.id AND i.dealer=$2
				 WHERE r.id=$1 AND r.expires_at>clock_timestamp() FOR UPDATE OF r`,
				[id, dealer],
			);
			if (!invite || invite.winning_deal)
				throw new Rejection(404, "Open invitation unavailable");
			if (invite.quote_id === input.id) return;
			if (invite.quote_id)
				throw new Rejection(409, "Only one quote per dealer is allowed");
			const expiry = new Date(input.expiresAt);
			if (
				expiry.getTime() < Date.now() + 60_000 ||
				expiry.getTime() > invite.rfq_expiry.getTime()
			)
				throw new Rejection(400, "Quote must expire within the request window");
			const message = settlementApprovalMessage(
				{
					id: input.id,
					seller: invite.seller,
					buyer: dealer,
					expiresAt: expiry.toISOString(),
				},
				invite.treasury,
				input.commitment,
			);
			if (!validWalletSignature(dealer, input.signature, message))
				throw new Rejection(401, "Invalid quote signature");
			await client.query(
				`UPDATE otc_rfq_invite SET quote_id=$3,quote_expires_at=$4,commitment=$5,signature=$6,seller_terms=$7,dealer_terms=$8
				 WHERE rfq_id=$1 AND dealer=$2`,
				[
					id,
					dealer,
					input.id,
					expiry,
					input.commitment,
					input.signature,
					input.sellerTerms,
					input.dealerTerms,
				],
			);
		});
		return { quoted: true };
	});

	api.post("/otc/rfqs/:id/accept", async (request) => {
		const seller = await walletOf(request);
		const id = idOf(request);
		const input = z
			.strictObject({ quoteId: z.uuid(), signature: walletSignature })
			.parse(request.body);
		const selected = await pool.query<{ dealer: string }>(
			"SELECT i.dealer FROM otc_rfq r JOIN otc_rfq_invite i ON i.rfq_id=r.id WHERE r.id=$1 AND r.seller=$2 AND i.quote_id=$3",
			[id, seller, input.quoteId],
		);
		if (!selected.rows[0]) throw new Rejection(404, "Quote unavailable");
		await Promise.all([screen(seller), screen(selected.rows[0].dealer)]);
		return transaction(pool, async (client) => {
			const {
				rows: [invite],
			} = await client.query<Invite>(
				`SELECT r.seller,r.treasury,r.winning_deal,i.* FROM otc_rfq r JOIN otc_rfq_invite i ON i.rfq_id=r.id
				 WHERE r.id=$1 AND r.seller=$2 AND i.quote_id=$3 FOR UPDATE OF r`,
				[id, seller, input.quoteId],
			);
			if (invite?.winning_deal === input.quoteId) return { id: input.quoteId };
			if (
				!invite?.quote_expires_at ||
				invite.winning_deal ||
				invite.quote_expires_at.getTime() <= Date.now()
			)
				throw new Rejection(409, "This quote expired or a different quote won");
			if (invite.treasury !== treasury)
				throw new Rejection(409, "The settlement treasury has changed");
			const message = settlementApprovalMessage(
				{
					id: input.quoteId,
					seller,
					buyer: invite.dealer,
					expiresAt: invite.quote_expires_at.toISOString(),
				},
				invite.treasury,
				invite.commitment,
			);
			if (!validWalletSignature(seller, input.signature, message))
				throw new Rejection(401, "Invalid acceptance signature");
			await client.query(
				`INSERT INTO listing (id,seller,category,bucket,quote,expires_at,encryption_key,ciphertext,private_rfq)
				 VALUES ($1,$2,'RFQ','private','SOL',$3,$4,$5,true)`,
				[
					id,
					seller,
					invite.quote_expires_at,
					invite.seller_key,
					invite.seller_terms,
				],
			);
			await client.query(
				`INSERT INTO offer (id,listing_id,buyer,encryption_key,ciphertext,accepted_at,seller_terms,buyer_terms)
				 VALUES ($1,$2,$3,$4,$5,now(),$5,$6)`,
				[
					input.quoteId,
					id,
					invite.dealer,
					invite.dealer_key,
					invite.seller_terms,
					invite.dealer_terms,
				],
			);
			await client.query(
				"INSERT INTO settlement_approval (offer_id,wallet,commitment,signature) VALUES ($1,$2,$3,$4),($1,$5,$3,$6)",
				[
					input.quoteId,
					seller,
					invite.commitment,
					input.signature,
					invite.dealer,
					invite.signature,
				],
			);
			await client.query("UPDATE otc_rfq SET winning_deal=$2 WHERE id=$1", [
				id,
				input.quoteId,
			]);
			return { id: input.quoteId };
		});
	});

	api.get("/otc/treasury", async (request) => {
		const wallet = await walletOf(request);
		const [policy, inbox] = await Promise.all([
			pool.query(
				"SELECT approver,sol_threshold,usdc_threshold FROM otc_treasury_policy WHERE wallet=$1",
				[wallet],
			),
			pool.query(
				`SELECT p.offer_id,p.wallet,p.review_ciphertext,p.approved_commitment,l.expires_at,
			 (SELECT s.commitment FROM settlement_approval s WHERE s.offer_id=p.offer_id AND s.wallet=p.wallet) AS commitment
			 FROM otc_deal_policy p JOIN offer o ON o.id=p.offer_id JOIN listing l ON l.id=o.listing_id
			 WHERE p.approver=$1 AND p.review_ciphertext IS NOT NULL AND NOT l.cancelled AND l.expires_at>now()
			 ORDER BY l.expires_at LIMIT 50`,
				[wallet],
			),
		]);
		return { policy: policy.rows[0] ?? null, inbox: inbox.rows, treasury };
	});

	api.post("/otc/treasury", async (request) => {
		const wallet = await walletOf(request);
		const input = z
			.strictObject({
				approver: walletAddress,
				sol: threshold,
				usdc: threshold,
			})
			.nullable()
			.parse(request.body);
		if (!input) {
			await pool.query("DELETE FROM otc_treasury_policy WHERE wallet=$1", [
				wallet,
			]);
		} else {
			if (input.approver === wallet)
				throw new Rejection(400, "Choose a separate approver wallet");
			await screen(input.approver);
			await pool.query(
				`INSERT INTO otc_treasury_policy VALUES ($1,$2,$3,$4) ON CONFLICT (wallet) DO UPDATE SET
				 approver=excluded.approver,sol_threshold=excluded.sol_threshold,usdc_threshold=excluded.usdc_threshold`,
				[wallet, input.approver, input.sol, input.usdc],
			);
		}
		return { saved: true };
	});

	api.get("/deals/:id/treasury", async (request) => {
		const wallet = await walletOf(request);
		const { rows } = await pool.query(
			"SELECT approver,sol_threshold,usdc_threshold,review_ciphertext IS NOT NULL AS sent,approved_commitment FROM otc_deal_policy WHERE offer_id=$1 AND wallet=$2",
			[idOf(request), wallet],
		);
		return { policy: rows[0] ?? null };
	});

	api.post("/deals/:id/treasury", async (request) => {
		const wallet = await walletOf(request);
		const input = z.strictObject({ ciphertext: envelope }).parse(request.body);
		const result = await pool.query(
			`UPDATE otc_deal_policy p SET review_ciphertext=$3 FROM settlement_approval s, offer o, listing l
			 WHERE p.offer_id=$1 AND p.wallet=$2 AND p.approved_commitment IS NULL
			 AND s.offer_id=p.offer_id AND s.wallet=p.wallet AND o.id=p.offer_id AND l.id=o.listing_id
			 AND NOT l.cancelled AND l.expires_at>now()`,
			[idOf(request), wallet, input.ciphertext],
		);
		if (!result.rowCount)
			throw new Rejection(
				409,
				"Sign the terms first and use an active deal with a treasury policy",
			);
		return { sent: true };
	});

	api.post("/otc/treasury/:id/approve", async (request) => {
		const approver = await walletOf(request);
		const id = idOf(request);
		const input = z
			.strictObject({
				owner: walletAddress,
				commitment: termsCommitment,
				signature: walletSignature,
			})
			.parse(request.body);
		if (
			!validWalletSignature(
				approver,
				input.signature,
				treasuryApprovalMessage(id, input.owner, input.commitment),
			)
		)
			throw new Rejection(401, "Invalid treasury approval signature");
		await screen(approver);
		const result = await pool.query(
			`UPDATE otc_deal_policy p SET approved_commitment=s.commitment, approval_signature=$5 FROM settlement_approval s, offer o, listing l
			 WHERE p.offer_id=$1 AND p.wallet=$2 AND p.approver=$3 AND p.review_ciphertext IS NOT NULL
			 AND s.offer_id=p.offer_id AND s.wallet=p.wallet AND s.commitment=$4
			 AND o.id=p.offer_id AND l.id=o.listing_id AND NOT l.cancelled AND l.expires_at>now()`,
			[id, input.owner, approver, input.commitment, input.signature],
		);
		if (!result.rowCount)
			throw new Rejection(409, "No active approval request for these terms");
		return { approved: true };
	});
}
