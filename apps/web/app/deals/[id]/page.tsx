"use client";
import { useQuery } from "@tanstack/react-query";
import { termsInput } from "@veil/core/contracts";
import {
	prepareSettlementApproval,
	settlementApprovalMessage,
} from "@veil/core/settlement-approval";
import { vaultIdentityHost } from "@veil/core/site";
import {
	dealEncryptionKey,
	decode,
	encode,
	openTerms,
	sealTerms,
} from "@veil/core/vault";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { expiry, short } from "../../otc/types";
import { api, useSession } from "../../providers";
import { signMessage } from "../../wallet";

interface Deal {
	id: string;
	listing_id: string;
	seller: string;
	buyer: string;
	expires_at: string;
	state: "OFFERED" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
	ciphertext: string | null;
	terms: string | null;
	buyer_encryption_key: string | null;
	counterparty_encryption_key: string | null;
	settlement_treasury: string | null;
	settlement_enabled: boolean;
	settlement_funding_enabled: boolean;
	settlement_commitment: string | null;
	counterparty_commitment: string | null;
}

type Escrow = {
	state: "not-created" | "open" | "closed";
	trade?: string;
	sellerFunded?: boolean;
	buyerFunded?: boolean;
	canRefund?: boolean;
};

type EscrowAction = "create" | "fund" | "settle" | "refund";

export default function DealRoom() {
	const { id } = useParams<{ id: string }>();
	const { token, seed, account, wallet } = useSession();
	const [terms, setTerms] = useState("");
	const [preparedTerms, setPreparedTerms] = useState<
		{
			id: string;
			wallet: string;
			ciphertext: string;
			treasury: string;
			quote: string;
		} & Awaited<ReturnType<typeof prepareSettlementApproval>>
	>();
	const [approvalNotice, setApprovalNotice] = useState("");
	const [transactionSignature, setTransactionSignature] = useState("");
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const query = useQuery({
		queryKey: ["deal", id, account?.address],
		queryFn: () => api<Deal>(`/deals/${id}`, undefined, token),
		enabled: Boolean(token),
		retry: false,
		refetchInterval: 15_000,
	});
	const deal = query.data;
	const escrowQuery = useQuery({
		queryKey: ["escrow", id, account?.address],
		queryFn: () => api<Escrow>(`/deals/${id}/escrow`, undefined, token),
		enabled: Boolean(token && deal?.settlement_enabled),
		retry: false,
		refetchInterval: 12_000,
	});
	const escrow = escrowQuery.data;

	const approval =
		seed &&
		deal &&
		preparedTerms &&
		preparedTerms.id === deal.id &&
		preparedTerms.wallet === account?.address &&
		preparedTerms.ciphertext === deal.terms &&
		preparedTerms.treasury === deal.settlement_treasury
			? preparedTerms
			: undefined;
	async function reveal() {
		const ciphertext = deal?.terms ?? deal?.ciphertext;
		if (!seed || !ciphertext) return;
		try {
			const key = await dealEncryptionKey(
				seed,
				vaultIdentityHost(window.location.host),
			);
			try {
				const input = JSON.parse(openTerms(ciphertext, key.secretKey));
				const value = deal?.terms
					? termsInput.parse(input)
					: termsInput.omit({ mint: true, minimumFill: true }).parse(input);
				const asset = "mint" in value ? ` · Mint ${String(value.mint)}` : "";
				setTerms(
					`${value.size} tokens at ${value.price} ${value.quote} each${asset}`,
				);
				if (
					deal?.state === "ACCEPTED" &&
					deal.terms &&
					account &&
					deal.settlement_treasury &&
					deal.counterparty_encryption_key
				) {
					setApprovalNotice("");
					try {
						const prepared = await prepareSettlementApproval({
							dealId: deal.id,
							terms: termsInput.parse(value),
							treasury: deal.settlement_treasury,
							ownSecretKey: key.secretKey,
							otherPublicKey: decode(deal.counterparty_encryption_key),
						});
						setPreparedTerms({
							...prepared,
							id: deal.id,
							wallet: account.address,
							ciphertext: deal.terms,
							treasury: deal.settlement_treasury,
							quote: value.quote,
						});
					} catch (error) {
						setApprovalNotice(
							error instanceof Error
								? error.message
								: "Could not prepare settlement terms",
						);
					}
				}
			} finally {
				key.secretKey.fill(0);
			}
		} catch {
			setNotice("Could not decrypt this offer");
		}
	}
	async function accept() {
		if (!seed || !token || !deal?.ciphertext || !deal.buyer_encryption_key)
			return;
		setBusy(true);
		setNotice("");
		try {
			const listing = await api<{ ciphertext: string }>(
				`/listings/${deal.listing_id}/private`,
				undefined,
				token,
			);
			const key = await dealEncryptionKey(
				seed,
				vaultIdentityHost(window.location.host),
			);
			try {
				const original = termsInput.parse(
					JSON.parse(openTerms(listing.ciphertext, key.secretKey)),
				);
				const proposal = termsInput
					.omit({ mint: true, minimumFill: true })
					.parse(JSON.parse(openTerms(deal.ciphertext, key.secretKey)));
				if (original.quote !== proposal.quote)
					throw new Error("Offer quote differs from the listing");
				const agreed = JSON.stringify({ ...proposal, mint: original.mint });
				await api(
					`/deals/${id}/accept`,
					{
						method: "POST",
						body: JSON.stringify({
							sellerTerms: sealTerms(agreed, key.publicKey),
							buyerTerms: sealTerms(agreed, decode(deal.buyer_encryption_key)),
						}),
					},
					token,
				);
			} finally {
				key.secretKey.fill(0);
			}
			setTerms("");
			await query.refetch();
		} catch (error) {
			setNotice(
				error instanceof Error ? error.message : "Could not accept offer",
			);
		} finally {
			setBusy(false);
		}
	}
	async function approveSettlement() {
		if (!approval || !deal || !account || !wallet || !token) return;
		setBusy(true);
		setApprovalNotice("");
		try {
			const message = settlementApprovalMessage(
				{
					id: deal.id,
					seller: deal.seller,
					buyer: deal.buyer,
					expiresAt: new Date(deal.expires_at).toISOString(),
				},
				approval.treasury,
				approval.commitment,
			);
			const signature = await signMessage(wallet, account, message);
			await api(
				`/deals/${deal.id}/settlement-approval`,
				{
					method: "POST",
					body: JSON.stringify({
						commitment: approval.commitment,
						signature: encode(signature),
					}),
				},
				token,
			);
			await query.refetch();
		} catch (error) {
			setApprovalNotice(
				error instanceof Error ? error.message : "Could not record approval",
			);
		} finally {
			setBusy(false);
		}
	}

	async function escrowAction(action: EscrowAction) {
		if (!deal || !token || !wallet || !account || busy) return;
		const signer = wallet.features["solana:signTransaction"];
		if (
			!signer?.supportedTransactionVersions.includes(1) ||
			!account.chains.includes("solana:mainnet")
		) {
			setApprovalNotice(
				"Connect a mainnet wallet that supports Solana v1 transaction signing.",
			);
			return;
		}
		setBusy(true);
		setTransactionSignature("");
		setApprovalNotice("Preparing Solana transaction");
		try {
			const path = `/deals/${deal.id}/escrow`;
			const prepared = await api<{
				id: string;
				wire: string;
				signature: string | null;
			}>(
				`${path}/prepare/${action}`,
				{
					method: "POST",
					body: JSON.stringify(
						action === "create" && approval
							? { opening: approval.opening }
							: {},
					),
				},
				token,
			);
			if (prepared.signature) {
				setTransactionSignature(prepared.signature);
				setApprovalNotice(
					"This transaction was already submitted. Check its status before retrying.",
				);
				await escrowQuery.refetch();
				return;
			}
			setApprovalNotice("Review and approve the transaction in your wallet");
			const [signed] = await signer.signTransaction({
				account,
				chain: "solana:mainnet",
				transaction: decode(prepared.wire),
			});
			if (!signed)
				throw new Error("Wallet did not return a signed transaction");
			const result = await api<{ signature: string }>(
				`${path}/submit`,
				{
					method: "POST",
					body: JSON.stringify({
						id: prepared.id,
						wire: encode(signed.signedTransaction),
					}),
				},
				token,
			);
			setTransactionSignature(result.signature);
			setApprovalNotice(
				"Transaction submitted. Solana confirmation can take a moment.",
			);
			await escrowQuery.refetch();
		} catch (error) {
			setApprovalNotice(
				error instanceof Error ? error.message : "The escrow action failed",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="stack">
			<div className="section-head">
				<h1>Deal room</h1>
				<p>Review the offer and track its status.</p>
			</div>
			{!token ? (
				<div className="panel">Sign in with a participating wallet.</div>
			) : query.isError ? (
				<div className="panel" role="alert">
					{query.error.message}
				</div>
			) : !deal ? (
				<div className="panel">Loading deal…</div>
			) : (
				<div className="grid two">
					<article className="panel stack">
						<div className="split">
							<h2>Offer</h2>
							<span className="tag">{deal.state}</span>
						</div>
						<dl>
							<div>
								<dt>Seller</dt>
								<dd>{short(deal.seller)}</dd>
							</div>
							<div>
								<dt>Buyer</dt>
								<dd>{short(deal.buyer)}</dd>
							</div>
							<div>
								<dt>Expires</dt>
								<dd>{expiry(deal.expires_at)}</dd>
							</div>
						</dl>
						<Link href={`/otc/${deal.listing_id}`}>View listing</Link>
						{seed && (deal.ciphertext || deal.terms) && (
							<button type="button" onClick={reveal}>
								{deal.terms ? "Decrypt accepted terms" : "Decrypt offer"}
							</button>
						)}
						{seed && (deal.ciphertext || deal.terms) && terms && <p>{terms}</p>}
						{seed && deal.ciphertext && terms && deal.state === "OFFERED" && (
							<button
								className="primary"
								type="button"
								disabled={busy}
								onClick={accept}
							>
								Accept offer
							</button>
						)}
						{notice && <p role="alert">{notice}</p>}
					</article>
					<article className="panel stack">
						<h2>Settlement</h2>
						{deal.state === "ACCEPTED" && deal.settlement_treasury && (
							<>
								<p>
									Both wallets can sign the agreed terms. Assets and amounts
									will be public if the trade settles on Solana.
								</p>
								<dl>
									<div>
										<dt>Your approval</dt>
										<dd>{deal.settlement_commitment ? "Signed" : "Pending"}</dd>
									</div>
									<div>
										<dt>Counterparty approval</dt>
										<dd>
											{deal.counterparty_commitment ? "Signed" : "Pending"}
										</dd>
									</div>
									{approval && (
										<>
											<div>
												<dt>Quote total</dt>
												<dd>
													{approval.quoteTotal} {approval.quote}
												</dd>
											</div>
											<div>
												<dt>Platform fee</dt>
												<dd>
													{approval.platformFee} {approval.quote}
												</dd>
											</div>
										</>
									)}
								</dl>
								{approval && !deal.settlement_commitment && (
									<button
										className="primary"
										type="button"
										disabled={
											busy ||
											Boolean(
												deal.counterparty_commitment &&
													deal.counterparty_commitment !== approval.commitment,
											)
										}
										onClick={approveSettlement}
									>
										Sign settlement terms
									</button>
								)}
								{!approval && !deal.settlement_commitment && (
									<p>Decrypt the accepted terms to review and sign.</p>
								)}
								{approval &&
									deal.counterparty_commitment &&
									deal.counterparty_commitment !== approval.commitment && (
										<p role="alert">
											The counterparty’s signature covers different terms.
										</p>
									)}
							</>
						)}
						{deal.settlement_enabled ? (
							<>
								{escrowQuery.isError && (
									<p role="alert">{escrowQuery.error.message}</p>
								)}
								{escrow?.trade && (
									<a href={`https://solscan.io/account/${escrow.trade}`}>
										View escrow on Solscan
									</a>
								)}
								{escrow?.state === "open" && (
									<dl>
										<div>
											<dt>Seller’s leg</dt>
											<dd>{escrow.sellerFunded ? "Funded" : "Waiting"}</dd>
										</div>
										<div>
											<dt>Buyer’s leg</dt>
											<dd>{escrow.buyerFunded ? "Funded" : "Waiting"}</dd>
										</div>
									</dl>
								)}
								{escrow?.state === "closed" && <p>Escrow closed on Solana.</p>}
								<div className="actions">
									{deal.settlement_funding_enabled &&
										deal.state === "ACCEPTED" &&
										escrow?.state === "not-created" &&
										approval &&
										deal.settlement_commitment === approval.commitment &&
										deal.counterparty_commitment === approval.commitment && (
											<button
												type="button"
												disabled={busy}
												onClick={() => escrowAction("create")}
											>
												Publish terms and create escrow
											</button>
										)}
									{deal.settlement_funding_enabled &&
										deal.state === "ACCEPTED" &&
										escrow?.state === "open" &&
										!(account?.address === deal.seller
											? escrow.sellerFunded
											: escrow.buyerFunded) && (
											<button
												type="button"
												disabled={busy}
												onClick={() => escrowAction("fund")}
											>
												Fund my side
											</button>
										)}
									{deal.settlement_funding_enabled &&
										deal.state === "ACCEPTED" &&
										escrow?.state === "open" &&
										escrow.sellerFunded &&
										escrow.buyerFunded &&
										account?.address === deal.seller && (
											<button
												type="button"
												className="primary"
												disabled={busy}
												onClick={() => escrowAction("settle")}
											>
												Settle trade and pay fee
											</button>
										)}
									{escrow?.canRefund && (
										<button
											type="button"
											disabled={busy}
											onClick={() => escrowAction("refund")}
										>
											Refund my side
										</button>
									)}
								</div>
								{escrow?.state === "open" && (
									<p>SOL is held as wrapped SOL for this trade.</p>
								)}
							</>
						) : (
							<p>On-chain funding and settlement are unavailable.</p>
						)}
						{approvalNotice && <p role="status">{approvalNotice}</p>}
						{transactionSignature && (
							<a href={`https://solscan.io/tx/${transactionSignature}`}>
								Check transaction on Solscan
							</a>
						)}
					</article>
				</div>
			)}
		</section>
	);
}
