"use client";

import { useQuery } from "@tanstack/react-query";
import { parseUnits } from "@veil/core/fees";
import { treasuryApprovalMessage } from "@veil/core/otc-workflows";
import {
	settlementOpeningInput,
	verifySettlementOpening,
} from "@veil/core/settlement-approval";
import { encode, openTerms } from "@veil/core/vault";
import { type FormEvent, useState } from "react";
import { api, useSession } from "../../providers";
import { signMessage } from "../../wallet";
import { expiry, short } from "../types";
import {
	errorText,
	formatQuoteUnits,
	type Policy,
	post,
	withDeskKey,
} from "../workflows";

type ReviewRequest = {
	offer_id: string;
	wallet: string;
	review_ciphertext: string;
	commitment: string;
	approved_commitment: string | null;
	expires_at: string;
};

async function openReview(
	request: ReviewRequest,
	seed: Uint8Array<ArrayBuffer>,
	treasury: string,
) {
	return withDeskKey(seed, async (keys) => {
		const opening = settlementOpeningInput.parse(
			JSON.parse(openTerms(request.review_ciphertext, keys.secretKey)),
		);
		const review = await verifySettlementOpening(
			request.offer_id,
			treasury,
			opening,
		);
		if (review.commitment !== request.commitment)
			throw new Error("The review differs from the signed trade terms");
		return {
			...review,
			terms: opening.terms,
			ciphertext: request.review_ciphertext,
		};
	});
}

export function Treasury({ address }: { address: string }) {
	const { token, seed, wallet, account } = useSession();
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const [reviews, setReviews] = useState<
		Record<string, Awaited<ReturnType<typeof openReview>>>
	>({});
	const query = useQuery({
		queryKey: ["treasury", address],
		queryFn: () =>
			api<{ policy: Policy | null; inbox: ReviewRequest[]; treasury?: string }>(
				"/otc/treasury",
				undefined,
				token,
			),
		retry: false,
	});
	const policy = query.data?.policy;

	async function run(action: () => Promise<void>) {
		setBusy(true);
		setNotice("");
		try {
			await action();
		} catch (error) {
			setNotice(errorText(error));
		} finally {
			setBusy(false);
		}
	}

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const limit = (field: string, decimals: number) => {
			const value = String(form.get(field)).trim();
			return /^0+(\.0+)?$/.test(value)
				? "0"
				: parseUnits(value, decimals).toString();
		};
		await api(
			"/otc/treasury",
			post({
				approver: form.get("approver"),
				sol: limit("sol", 9),
				usdc: limit("usdc", 6),
			}),
			token,
		);
		await query.refetch({ throwOnError: true });
		setNotice("Treasury policy saved for future accepted deals.");
	}

	async function reveal(request: ReviewRequest, key: string) {
		if (!seed || !query.data?.treasury)
			throw new Error("Treasury verification is unavailable");
		const reviewed = await openReview(request, seed, query.data.treasury);
		setReviews((old) => ({ ...old, [key]: reviewed }));
	}

	async function approve(
		request: ReviewRequest,
		review: Awaited<ReturnType<typeof openReview>>,
	) {
		if (!wallet || !account) return;
		const signature = await signMessage(
			wallet,
			account,
			treasuryApprovalMessage(
				request.offer_id,
				request.wallet,
				review.commitment,
			),
		);
		await api(
			`/otc/treasury/${request.offer_id}/approve`,
			post({
				owner: request.wallet,
				commitment: review.commitment,
				signature: encode(signature),
			}),
			token,
		);
		await query.refetch();
		setNotice("Treasury approval recorded.");
	}

	return (
		<section className="panel stack">
			<h2>Treasury approvals</h2>
			<p>
				Require a second wallet to approve trades above your SOL or USDC limit
				before fees before Primar creates escrow. Changes apply to future
				accepted deals.
			</p>
			{query.error && <p role="alert">{query.error.message}</p>}
			{query.data && (
				<form
					key={JSON.stringify(policy)}
					onSubmit={(event) => run(() => save(event))}
				>
					<label>
						Approver wallet
						<input name="approver" required defaultValue={policy?.approver} />
					</label>
					<label>
						SOL limit
						<input
							name="sol"
							inputMode="decimal"
							required
							defaultValue={
								policy ? formatQuoteUnits(BigInt(policy.sol_threshold), 9) : "0"
							}
						/>
					</label>
					<label>
						USDC limit
						<input
							name="usdc"
							inputMode="decimal"
							required
							defaultValue={
								policy
									? formatQuoteUnits(BigInt(policy.usdc_threshold), 6)
									: "0"
							}
						/>
					</label>
					<button type="submit" disabled={busy}>
						Save policy
					</button>
					{policy && (
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								run(async () => {
									await api("/otc/treasury", post(null), token);
									await query.refetch({ throwOnError: true });
									setNotice("Policy removed for future accepted deals.");
								})
							}
						>
							Remove policy
						</button>
					)}
				</form>
			)}
			<h3>Requests for your approval</h3>
			<button
				type="button"
				disabled={busy || query.isFetching}
				onClick={() =>
					run(async () => {
						await query.refetch({ throwOnError: true });
					})
				}
			>
				Refresh approvals
			</button>
			{query.data?.inbox.length === 0 && <p>No open approval requests.</p>}
			{query.data?.inbox.map((request) => {
				const key = `${request.offer_id}:${request.wallet}`;
				const review = reviews[key];
				return (
					<article key={key} className="panel stack">
						<p>
							Requested by {short(request.wallet)} · Expires{" "}
							{expiry(request.expires_at)}
						</p>
						{request.approved_commitment ? (
							<p>Approved</p>
						) : (
							<>
								<button
									type="button"
									disabled={busy || !seed}
									onClick={() => run(() => reveal(request, key))}
								>
									Decrypt and review
								</button>
								{review?.ciphertext === request.review_ciphertext && (
									<>
										<p>
											{review.terms.size} tokens at {review.terms.price}{" "}
											{review.terms.quote} each
										</p>
										<p>
											Mint <span className="mono">{review.terms.mint}</span>
										</p>
										<p>
											Gross {review.quoteTotal} {review.terms.quote} · Fee{" "}
											{review.platformFee} {review.terms.quote}
										</p>
										<button
											type="button"
											disabled={busy}
											onClick={() => run(() => approve(request, review))}
										>
											Sign treasury approval
										</button>
									</>
								)}
							</>
						)}
					</article>
				);
			})}
			{notice && <p role="status">{notice}</p>}
		</section>
	);
}
