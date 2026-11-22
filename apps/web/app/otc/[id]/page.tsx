"use client";
import { useQuery } from "@tanstack/react-query";
import { termsInput } from "@veil/core/contracts";
import { vaultIdentityHost } from "@veil/core/site";
import {
	dealEncryptionKey,
	decode,
	encode,
	openTerms,
	sealTerms,
} from "@veil/core/vault";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, useSession } from "../../providers";
import { expiry, type Listing, short } from "../types";

export default function Detail() {
	const { id } = useParams<{ id: string }>();
	const { account, seed, token } = useSession();
	const router = useRouter();
	const [notice, setNotice] = useState("");
	const [terms, setTerms] = useState("");
	const [busy, setBusy] = useState(false);
	const listing = useQuery({
		queryKey: ["listing", id],
		queryFn: () => api<Listing>(`/listings/${id}`),
		retry: false,
	});
	const own = Boolean(account && account.address === listing.data?.seller);
	const offers = useQuery({
		queryKey: ["offers", id, account?.address],
		queryFn: () =>
			api<{ id: string; buyer: string }[]>(
				`/listings/${id}/offers`,
				undefined,
				token,
			),
		enabled: Boolean(own && token),
		retry: false,
	});
	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!seed || !token || !listing.data) return;
		const form = new FormData(event.currentTarget);
		setBusy(true);
		setNotice("");
		try {
			const proposal = termsInput
				.omit({ mint: true, minimumFill: true })
				.parse({
					size: form.get("size"),
					price: form.get("price"),
					quote: listing.data.quote,
				});
			const key = await dealEncryptionKey(
				seed,
				vaultIdentityHost(window.location.host),
			);
			try {
				const ciphertext = sealTerms(
					JSON.stringify(proposal),
					decode(listing.data.encryption_key),
				);
				const result = await api<{ id: string }>(
					`/listings/${id}/offers`,
					{
						method: "POST",
						body: JSON.stringify({
							ciphertext,
							encryptionKey: encode(key.publicKey),
						}),
					},
					token,
				);
				router.push(`/deals/${result.id}`);
			} finally {
				key.secretKey.fill(0);
			}
		} catch (error) {
			setNotice(
				error instanceof Error && error.name !== "ZodError"
					? error.message
					: "Check the size and price.",
			);
		} finally {
			setBusy(false);
		}
	}
	async function reveal() {
		if (!seed || !token) return;
		try {
			const { ciphertext } = await api<{ ciphertext: string }>(
				`/listings/${id}/private`,
				undefined,
				token,
			);
			const key = await dealEncryptionKey(
				seed,
				vaultIdentityHost(window.location.host),
			);
			try {
				const value = termsInput.parse(
					JSON.parse(openTerms(ciphertext, key.secretKey)),
				);
				setTerms(`${value.size} tokens at ${value.price} ${value.quote} each`);
			} finally {
				key.secretKey.fill(0);
			}
		} catch {
			setNotice("Could not decrypt listing terms");
		}
	}
	async function cancel() {
		if (!token) return;
		setBusy(true);
		try {
			await api(`/listings/${id}`, { method: "DELETE" }, token);
			router.push("/otc");
		} catch (error) {
			setNotice(
				error instanceof Error ? error.message : "Could not cancel listing",
			);
		} finally {
			setBusy(false);
		}
	}
	if (listing.isPending) return <div className="panel">Loading listing…</div>;
	if (listing.isError)
		return (
			<div className="panel" role="alert">
				{listing.error.message}
			</div>
		);
	const item = listing.data;
	return (
		<section className="stack">
			<div className="desk-hero">
				<Link href="/otc">OTC board</Link>
				<h1>{item.category}</h1>
			</div>
			<div className="grid two">
				<article className="panel stack">
					<h2>Listing details</h2>
					{item.mint && <code>{item.mint}</code>}
					<dl>
						<div>
							<dt>Size</dt>
							<dd>{item.bucket}</dd>
						</div>
						<div>
							<dt>Quote</dt>
							<dd>{item.quote}</dd>
						</div>
						<div>
							<dt>Seller</dt>
							<dd>{short(item.seller)}</dd>
						</div>
						<div>
							<dt>Expires</dt>
							<dd>{expiry(item.expires_at)}</dd>
						</div>
					</dl>
					{own && seed && token && (
						<div className="actions">
							<button type="button" onClick={reveal}>
								Decrypt my terms
							</button>
							<button type="button" disabled={busy} onClick={cancel}>
								Cancel listing
							</button>
						</div>
					)}
					{own && seed && token && terms && <p>{terms}</p>}
				</article>
				{own ? (
					<article className="panel">
						<h2>Incoming offers</h2>
						{offers.isError ? (
							<p role="alert">{offers.error.message}</p>
						) : offers.data?.length ? (
							<ul className="rows">
								{offers.data.map((offer) => (
									<li key={offer.id}>
										<span>{short(offer.buyer)}</span>
										<Link href={`/deals/${offer.id}`}>Review offer</Link>
									</li>
								))}
							</ul>
						) : (
							<p>
								{token ? "No offers to review." : "Sign in to see your offers."}
							</p>
						)}
					</article>
				) : (
					<form className="panel stack" onSubmit={submit}>
						<h2>Make an offer</h2>
						<p>
							Only the seller can decrypt the offer. Assets and amounts become
							public when the deal is posted to on-chain escrow.
						</p>
						<label>
							Size
							<input name="size" inputMode="decimal" required />
						</label>
						<label>
							Price per token ({item.quote})
							<input name="price" inputMode="decimal" required />
						</label>
						<button
							type="submit"
							className="primary"
							disabled={!seed || !token || busy}
						>
							Send encrypted offer
						</button>
						{(!seed || !token) && (
							<p>Unlock your vault and sign in to submit.</p>
						)}
					</form>
				)}
			</div>
			{notice && (
				<div className="inline-note" role="alert">
					{notice}
				</div>
			)}
		</section>
	);
}
