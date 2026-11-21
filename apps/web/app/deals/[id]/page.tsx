"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { termsInput } from "@veil/core/contracts";
import {
	dealEncryptionKey,
	decode,
	openTerms,
	sealTerms,
} from "@veil/core/vault";
import { api, useSession } from "../../providers";
import { expiry, short } from "../../otc/types";

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
}

export default function DealRoom() {
	const { id } = useParams<{ id: string }>();
	const { token, seed, account } = useSession();
	const [terms, setTerms] = useState("");
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
	async function reveal() {
		const ciphertext = deal?.terms ?? deal?.ciphertext;
		if (!seed || !ciphertext) return;
		try {
			const key = await dealEncryptionKey(seed, window.location.host);
			try {
				const input = JSON.parse(openTerms(ciphertext, key.secretKey));
				const value = deal?.terms
					? termsInput.parse(input)
					: termsInput.omit({ mint: true, minimumFill: true }).parse(input);
				const asset = "mint" in value ? ` · Mint ${String(value.mint)}` : "";
				setTerms(
					`${value.size} tokens at ${value.price} ${value.quote} each${asset}`,
				);
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
			const key = await dealEncryptionKey(seed, window.location.host);
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
						<p>
							Funding and atomic settlement are unavailable. Acceptance is
							recorded as a negotiation status.
						</p>
						<div className="actions">
							<button type="button" disabled>
								Fund
							</button>
							<button type="button" disabled>
								Seal
							</button>
						</div>
					</article>
				</div>
			)}
		</section>
	);
}
