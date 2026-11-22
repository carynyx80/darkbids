import nacl from "tweetnacl";
import { expect, test } from "vitest";
import {
	prepareSettlementApproval,
	settlementApprovalMessage,
} from "./settlement-approval";

test("both counterparties derive the same private commitment and exact fee", async () => {
	const seller = nacl.box.keyPair();
	const buyer = nacl.box.keyPair();
	const context = {
		dealId: "deal",
		treasury: "11111111111111111111111111111111",
		terms: {
			mint: "So11111111111111111111111111111111111111112",
			size: "2.0",
			price: "1.125",
			quote: "USDC" as const,
		},
	};
	const approval = await prepareSettlementApproval({
		...context,
		ownSecretKey: seller.secretKey,
		otherPublicKey: buyer.publicKey,
	});
	const approveAsBuyer = (price: string, dealId = context.dealId) =>
		prepareSettlementApproval({
			...context,
			dealId,
			terms: { ...context.terms, size: "2", price },
			ownSecretKey: buyer.secretKey,
			otherPublicKey: seller.publicKey,
		});
	expect((await approveAsBuyer("1.1250")).commitment).toBe(approval.commitment);
	expect((await approveAsBuyer("1.126")).commitment).not.toBe(
		approval.commitment,
	);
	expect((await approveAsBuyer("1.125", "other")).commitment).not.toBe(
		approval.commitment,
	);
	expect(approval.quoteTotal).toBe("2.25");
	expect(approval.platformFee).toBe("0.01125");
	await expect(approveAsBuyer("0.00000001")).rejects.toThrow("precision");

	const signer = nacl.sign.keyPair();
	const deal = {
		id: context.dealId,
		seller: "seller",
		buyer: "buyer",
		expiresAt: "2026-11-23T00:00:00.000Z",
	};
	const message = settlementApprovalMessage(
		deal,
		context.treasury,
		approval.commitment,
	);
	const signature = nacl.sign.detached(message, signer.secretKey);
	expect(nacl.sign.detached.verify(message, signature, signer.publicKey)).toBe(
		true,
	);
	expect(
		nacl.sign.detached.verify(
			settlementApprovalMessage(
				{ ...deal, buyer: "other" },
				context.treasury,
				approval.commitment,
			),
			signature,
			signer.publicKey,
		),
	).toBe(false);
});
