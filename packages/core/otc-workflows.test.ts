import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import {
	receiptMessage,
	signedReceipt,
	treasuryApprovalMessage,
	validWalletSignature,
} from "./otc-workflows";
import { encode } from "./vault";

describe("OTC workflow signatures", () => {
	const signer = nacl.sign.keyPair();
	const wallet = bs58.encode(signer.publicKey);
	const deal = "8fc4c3b4-941f-43c7-a25d-b56e100358dc";
	const signature = (message: Uint8Array) =>
		encode(nacl.sign.detached(message, signer.secretKey));

	it("binds treasury approval to the deal, owner, and exact commitment", () => {
		const commitment = encode(new Uint8Array(32));
		const approval = signature(
			treasuryApprovalMessage(deal, wallet, commitment),
		);
		expect(
			validWalletSignature(
				wallet,
				approval,
				treasuryApprovalMessage(deal, wallet, commitment),
			),
		).toBe(true);
		expect(
			validWalletSignature(
				wallet,
				approval,
				treasuryApprovalMessage(crypto.randomUUID(), wallet, commitment),
			),
		).toBe(false);
		expect(
			validWalletSignature(
				wallet,
				approval,
				treasuryApprovalMessage(
					deal,
					bs58.encode(new Uint8Array(32)),
					commitment,
				),
			),
		).toBe(false);
		expect(
			validWalletSignature(
				wallet,
				approval,
				treasuryApprovalMessage(
					deal,
					wallet,
					encode(new Uint8Array(32).fill(1)),
				),
			),
		).toBe(false);
	});

	it("verifies only the fields and transaction included in a signed receipt", () => {
		const statement = {
			version: 1 as const,
			deal,
			signer: wallet,
			transaction: bs58.encode(new Uint8Array(64).fill(1)),
			details: { quote: "USDC" as const, price: "2.50" },
		};
		const receipt = signedReceipt.parse({
			statement,
			signature: signature(receiptMessage(statement)),
		});
		expect(
			validWalletSignature(
				wallet,
				receipt.signature,
				receiptMessage(receipt.statement),
			),
		).toBe(true);
		expect(
			validWalletSignature(
				wallet,
				receipt.signature,
				receiptMessage({ ...statement, details: { quote: "USDC" } }),
			),
		).toBe(false);
		expect(
			validWalletSignature(
				wallet,
				receipt.signature,
				receiptMessage({
					...statement,
					details: { ...statement.details, size: "10" },
				}),
			),
		).toBe(false);
		expect(
			validWalletSignature(
				wallet,
				receipt.signature,
				receiptMessage({
					...statement,
					transaction: bs58.encode(new Uint8Array(64).fill(2)),
				}),
			),
		).toBe(false);
	});
});
