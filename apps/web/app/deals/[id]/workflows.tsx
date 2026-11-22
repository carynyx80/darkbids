"use client";

import { useQuery } from "@tanstack/react-query";
import {
	receiptFields,
	receiptMessage,
	receiptStatement,
} from "@veil/core/otc-workflows";
import type { prepareSettlementApproval } from "@veil/core/settlement-approval";
import { decode, encode, sealTerms } from "@veil/core/vault";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { short } from "../../otc/types";
import { contact, errorText, type Policy, post } from "../../otc/workflows";
import { api, useSession } from "../../providers";
import { signMessage } from "../../wallet";

type Prepared = Awaited<ReturnType<typeof prepareSettlementApproval>>;

export function DealTreasury({
	id,
	approval,
	signed,
}: {
	id: string;
	approval?: Prepared;
	signed: string | null;
}) {
	const { token, account } = useSession();
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const query = useQuery({
		queryKey: ["deal-treasury", id, account?.address],
		queryFn: () =>
			api<{
				policy:
					| (Policy & { sent: boolean; approved_commitment: string | null })
					| null;
			}>(`/deals/${id}/treasury`, undefined, token),
		retry: false,
	});
	const policy = query.data?.policy;
	if (query.error) return <p role="alert">{query.error.message}</p>;
	if (!policy) return null;
	const requiresApproval =
		approval &&
		approval.quoteAmount >
			BigInt(
				approval.opening.terms.quote === "SOL"
					? policy.sol_threshold
					: policy.usdc_threshold,
			);
	async function send() {
		if (!approval || !token || !policy) return;
		setBusy(true);
		setNotice("");
		try {
			const { encryption_key: key } = await contact(policy.approver, token);
			await api(
				`/deals/${id}/treasury`,
				post({
					ciphertext: sealTerms(JSON.stringify(approval.opening), decode(key)),
				}),
				token,
			);
			await query.refetch();
		} catch (error) {
			setNotice(errorText(error));
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="stack">
			<h3>Treasury approval</h3>
			<p>
				Approver {short(policy.approver)} ·{" "}
				{policy.approved_commitment
					? "Approved"
					: !approval
						? "Decrypt terms to check your limit"
						: !requiresApproval
							? "Within your limit"
							: policy.sent
								? "Awaiting approval"
								: "Required"}
			</p>
			{requiresApproval && !policy.approved_commitment && (
				<button
					type="button"
					disabled={busy || signed !== approval.commitment}
					onClick={send}
				>
					{policy.sent
						? "Resend encrypted review"
						: "Send encrypted review to approver"}
				</button>
			)}
			{notice && <p role="alert">{notice}</p>}
		</div>
	);
}

export function TradeReceipt({
	id,
	approval,
	signed,
}: {
	id: string;
	approval: Prepared;
	signed: string;
}) {
	const { account, token, wallet } = useSession();
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	if (signed !== approval.commitment) return null;

	async function exportReceipt(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!account || !wallet || busy) return;
		const values = new FormData(event.currentTarget);
		const available = {
			...approval.opening.terms,
			quoteTotal: approval.quoteTotal,
			platformFee: approval.platformFee,
		};
		const details = Object.fromEntries(
			receiptFields
				.filter((field) => values.has(field))
				.map((field) => [field, available[field]]),
		);
		setBusy(true);
		setNotice("");
		try {
			if (!Object.keys(details).length)
				throw new Error("Select at least one field.");
			const { signature: transaction } = await api<{
				signature: string | null;
			}>(`/deals/${id}/receipt`, undefined, token);
			if (!transaction)
				throw new Error(
					"A finalized settlement is required. Check again once the transaction finalizes.",
				);
			const statement = receiptStatement.parse({
				version: 1,
				deal: id,
				signer: account.address,
				transaction,
				details,
			});
			const signature = encode(
				await signMessage(wallet, account, receiptMessage(statement)),
			);
			const url = URL.createObjectURL(
				new Blob([JSON.stringify({ statement, signature }, null, 2)], {
					type: "application/json",
				}),
			);
			const link = document.createElement("a");
			link.href = url;
			link.download = `primar-receipt-${id}.json`;
			link.click();
			window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		} catch (error) {
			setNotice(errorText(error));
		} finally {
			setBusy(false);
		}
	}
	return (
		<form className="stack" onSubmit={exportReceipt}>
			<h3>Share a trade receipt</h3>
			<p>
				Choose which terms to include in your signed statement. The receipt
				includes your wallet address and the finalized settlement transaction.
			</p>
			<fieldset className="receipt-fields">
				<legend>Fields to share</legend>
				{receiptFields.map((field) => (
					<label key={field}>
						<input type="checkbox" name={field} />
						{field === "quoteTotal"
							? "Gross amount"
							: field === "platformFee"
								? "Platform fee"
								: {
										mint: "Token mint",
										size: "Size",
										price: "Unit price",
										quote: "Quote currency",
									}[field]}
					</label>
				))}
			</fieldset>
			<button type="submit" disabled={busy}>
				Sign and download receipt
			</button>
			<Link href="/otc/receipts">Verify a receipt</Link>
			{notice && <p role="alert">{notice}</p>}
		</form>
	);
}
