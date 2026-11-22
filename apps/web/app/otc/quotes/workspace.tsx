"use client";

import { useQuery } from "@tanstack/react-query";
import { termsInput, walletAddress } from "@veil/core/contracts";
import { parseUnits } from "@veil/core/fees";
import { validWalletSignature } from "@veil/core/otc-workflows";
import {
	prepareSettlementApproval,
	settlementApprovalMessage,
} from "@veil/core/settlement-approval";
import { decode, encode, openTerms, sealTerms } from "@veil/core/vault";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { api, useSession } from "../../providers";
import { signMessage } from "../../wallet";
import { expiry, short } from "../types";
import {
	contact,
	errorText,
	formatQuoteUnits,
	post,
	withDeskKey,
} from "../workflows";
import { Treasury } from "./treasury";

const requestTerms = termsInput.omit({ price: true, minimumFill: true });
type Terms = z.infer<typeof requestTerms>;
type Invite = {
	id: string;
	seller: string;
	dealer: string;
	treasury: string;
	expires_at: string;
	request_copy: string;
	seller_key: string;
	dealer_key: string;
	quote_copy: string | null;
	quote_id: string | null;
	quote_expires_at: string | null;
	commitment: string | null;
	signature: string | null;
	winning_deal: string | null;
	closed: boolean;
	liquidity_mint: string | null;
	liquidity_quote: "SOL" | "USDC" | null;
};
type Reviewed = {
	invite: Invite;
	request: Terms;
	quote?: {
		price: string;
		net: bigint;
		netDisplay: string;
		message: Uint8Array;
	};
};

function quoteMessage(
	invite: Invite,
	id: string,
	expiresAt: string,
	commitment: string,
) {
	return settlementApprovalMessage(
		{ id, seller: invite.seller, buyer: invite.dealer, expiresAt },
		invite.treasury,
		commitment,
	);
}

export type LiquidityPage = {
	slug: string;
	name: string;
	description: string;
	mint: string;
	quote: "SOL" | "USDC";
	active_dealers: number;
};

type Routing = {
	dealers: { wallet: string; encryption_key: string }[];
	invited: boolean;
	optedIn: boolean;
};

export function QuoteWorkspace({
	address,
	liquidity,
}: {
	address: string;
	liquidity?: LiquidityPage;
}) {
	const { token, seed, wallet, account } = useSession();
	const router = useRouter();
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const [reviews, setReviews] = useState<Record<string, Reviewed[]>>({});
	const query = useQuery({
		queryKey: ["rfqs", address],
		queryFn: () => api<{ rows: Invite[] }>("/otc/rfqs", undefined, token),
		retry: false,
	});
	const routingPath = liquidity ? `/otc/liquidity/${liquidity.slug}` : "";
	const routing = useQuery({
		queryKey: ["liquidity-routing", routingPath, address],
		queryFn: () => api<Routing>(`${routingPath}/routing`, undefined, token),
		enabled: Boolean(liquidity && token),
		retry: false,
	});
	const groups = new Map<string, Invite[]>();
	for (const row of query.data?.rows ?? []) {
		const group = groups.get(row.id);
		if (group) group.push(row);
		else groups.set(row.id, [row]);
	}

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

	async function register() {
		if (!seed) return;
		await withDeskKey(seed, async (keys) => {
			await api("/otc/contact", post({ key: encode(keys.publicKey) }), token);
			setNotice("Encryption key registered.");
		});
	}

	async function create(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!seed || !token) return;
		const form = new FormData(event.currentTarget);
		const terms = requestTerms.parse({
			mint: liquidity?.mint ?? form.get("mint"),
			size: form.get("size"),
			quote: liquidity?.quote ?? form.get("quote"),
		});
		if (!/[1-9]/.test(terms.size)) throw new Error("Size must exceed zero");
		const routed = liquidity
			? (await api<Routing>(`${routingPath}/routing`, undefined, token)).dealers
			: undefined;
		const dealers = routed
			? routed.map(({ wallet }) => wallet)
			: z
					.array(walletAddress)
					.min(1)
					.max(5)
					.parse(
						String(form.get("dealers"))
							.split(/[\s,]+/)
							.filter(Boolean),
					);
		if (!dealers.length) throw new Error("No dealer has opted in yet.");
		const keysByWallet = new Map(
			routed?.map(({ wallet, encryption_key }) => [wallet, encryption_key]),
		);

		if (new Set(dealers).size !== dealers.length || dealers.includes(address))
			throw new Error("Choose different dealer wallets");
		const expiresAt = new Date(
			Date.now() + Number(form.get("hours")) * 3600_000,
		).toISOString();
		await withDeskKey(seed, async (keys) => {
			const sellerKey = encode(keys.publicKey);
			await api("/otc/contact", post({ key: sellerKey }), token);
			const plain = JSON.stringify(terms);
			const invites = await Promise.all(
				dealers.map(async (dealer) => {
					const dealerKey =
						keysByWallet.get(dealer) ??
						(await contact(dealer, token)).encryption_key;
					return {
						dealer,
						dealerKey,
						sellerCopy: sealTerms(plain, keys.publicKey),
						requestCopy: sealTerms(plain, decode(dealerKey)),
					};
				}),
			);
			await api(
				"/otc/rfqs",
				post({
					id: crypto.randomUUID(),
					expiresAt,
					sellerKey,
					invites,
					liquiditySlug: liquidity?.slug,
				}),
				token,
			);
		});
		await query.refetch();
		setNotice("Encrypted request sent.");
	}

	async function review(invites: Invite[]) {
		if (!seed) return;
		await withDeskKey(seed, async (keys) => {
			const next: Reviewed[] = [];
			for (const invite of invites) {
				const request = requestTerms.parse(
					JSON.parse(openTerms(invite.request_copy, keys.secretKey)),
				);
				if (
					invite.liquidity_mint &&
					(request.mint !== invite.liquidity_mint ||
						request.quote !== invite.liquidity_quote)
				) {
					setNotice(
						"A request did not match its liquidity page and was skipped.",
					);
					continue;
				}
				const item: Reviewed = { invite, request };
				if (
					invite.quote_copy &&
					invite.quote_id &&
					invite.quote_expires_at &&
					invite.commitment &&
					invite.signature
				) {
					try {
						const terms = termsInput.parse(
							JSON.parse(openTerms(invite.quote_copy, keys.secretKey)),
						);
						const expected = requestTerms.parse({
							mint: terms.mint,
							size: terms.size,
							quote: terms.quote,
						});
						if (
							expected.mint !== request.mint ||
							expected.size !== request.size ||
							expected.quote !== request.quote
						)
							throw new Error("Quote differs from request");
						const approval = await prepareSettlementApproval({
							dealId: invite.quote_id,
							terms,
							treasury: invite.treasury,
							ownSecretKey: keys.secretKey,
							otherPublicKey: decode(
								address === invite.seller
									? invite.dealer_key
									: invite.seller_key,
							),
						});
						const message = quoteMessage(
							invite,
							invite.quote_id,
							new Date(invite.quote_expires_at).toISOString(),
							approval.commitment,
						);
						if (
							approval.commitment !== invite.commitment ||
							!validWalletSignature(invite.dealer, invite.signature, message)
						)
							throw new Error("Quote signature does not match");
						const net =
							approval.quoteAmount -
							parseUnits(approval.platformFee, approval.quoteDecimals);
						item.quote = {
							price: terms.price,
							net,
							netDisplay: formatQuoteUnits(net, approval.quoteDecimals),
							message,
						};
					} catch {
						setNotice("One or more quotes could not be verified.");
					}
				}
				next.push(item);
			}
			next.sort((a, b) => Number((b.quote?.net ?? 0n) - (a.quote?.net ?? 0n)));
			setReviews((old) => ({ ...old, [invites[0].id]: next }));
		});
	}

	async function submitQuote(
		event: FormEvent<HTMLFormElement>,
		{ invite, request }: Reviewed,
	) {
		event.preventDefault();
		if (!seed || !account || !wallet || !token) return;
		const form = new FormData(event.currentTarget);
		const terms = termsInput.parse({ ...request, price: form.get("price") });
		const id = crypto.randomUUID();
		const expiresAt = new Date(
			Math.min(
				Date.parse(invite.expires_at),
				Date.now() + Number(form.get("minutes")) * 60_000,
			),
		).toISOString();
		await withDeskKey(seed, async (keys) => {
			const sellerKey = decode(invite.seller_key);
			const approval = await prepareSettlementApproval({
				dealId: id,
				terms,
				treasury: invite.treasury,
				ownSecretKey: keys.secretKey,
				otherPublicKey: sellerKey,
			});
			const signature = await signMessage(
				wallet,
				account,
				quoteMessage(invite, id, expiresAt, approval.commitment),
			);
			const plain = JSON.stringify(terms);
			await api(
				`/otc/rfqs/${invite.id}/quote`,
				post({
					id,
					expiresAt,
					commitment: approval.commitment,
					signature: encode(signature),
					sellerTerms: sealTerms(plain, sellerKey),
					dealerTerms: sealTerms(plain, keys.publicKey),
				}),
				token,
			);
		});
		const fresh = await query.refetch();
		const updated = fresh.data?.rows.filter((row) => row.id === invite.id);
		if (updated?.length) await review(updated);
		setNotice("Signed quote sent.");
	}

	async function accept({ invite, quote }: Reviewed) {
		if (!quote || !invite.quote_id || !account || !wallet || !token) return;
		const signature = await signMessage(wallet, account, quote.message);
		const result = await api<{ id: string }>(
			`/otc/rfqs/${invite.id}/accept`,
			post({ quoteId: invite.quote_id, signature: encode(signature) }),
			token,
		);
		router.push(`/deals/${result.id}`);
	}

	return (
		<>
			{liquidity ? (
				<section className="panel stack">
					<p>
						{routing.data?.dealers.length ?? 0} available dealers for this
						wallet.
					</p>
					{routing.error && <p role="alert">{routing.error.message}</p>}
					{routing.data?.invited && (
						<button
							type="button"
							disabled={busy}
							onClick={() =>
								run(async () => {
									const optedIn = !routing.data.optedIn;
									if (optedIn) await register();
									await api(`${routingPath}/dealer`, post({ optedIn }), token);
									await routing.refetch({ throwOnError: true });
									setNotice(
										optedIn
											? "You are accepting quote requests for this token."
											: "Dealer participation paused.",
									);
								})
							}
						>
							{routing.data.optedIn
								? "Pause dealer participation"
								: "Opt in as a dealer"}
						</button>
					)}
				</section>
			) : (
				<section className="panel stack">
					<h2>Dealer and approver access</h2>
					<p>
						Register once so a trader can encrypt a request to your wallet.
						Share your wallet address with them.
					</p>
					<button type="button" disabled={busy} onClick={() => run(register)}>
						Register encryption key
					</button>
				</section>
			)}

			<form
				className="panel stack"
				onSubmit={(event) => run(() => create(event))}
			>
				<h2>New sell request</h2>
				{!liquidity && (
					<label>
						Token mint
						<input name="mint" required />
					</label>
				)}
				<label>
					Full size
					<input name="size" inputMode="decimal" required />
				</label>
				{!liquidity && (
					<>
						<label>
							Quote currency
							<select name="quote">
								<option>USDC</option>
								<option>SOL</option>
							</select>
						</label>
						<label>
							Dealer wallet addresses (up to five)
							<textarea name="dealers" required />
						</label>
					</>
				)}
				<label>
					Request deadline (hours)
					<input
						name="hours"
						type="number"
						min="1"
						max="168"
						defaultValue="24"
						required
					/>
				</label>
				<button
					type="submit"
					disabled={busy || Boolean(liquidity && !routing.data?.dealers.length)}
				>
					Send private request
				</button>
			</form>
			<section className="panel stack">
				<h2>Requests and invitations</h2>
				<button
					type="button"
					disabled={busy || query.isFetching}
					onClick={() =>
						run(async () => {
							setReviews({});
							await query.refetch({ throwOnError: true });
						})
					}
				>
					Refresh requests
				</button>
				{query.error && <p role="alert">{query.error.message}</p>}
				{!query.isPending && !groups.size && (
					<p>No requests or invitations yet.</p>
				)}
				{Array.from(groups, ([id, invites]) => {
					const first = invites[0];
					const own = first.seller === address;
					const open =
						!first.closed && Date.parse(first.expires_at) > Date.now();
					const items = reviews[id];
					return (
						<article key={id} className="panel stack">
							<h3>
								{own
									? "Your sell request"
									: `Invitation from ${short(first.seller)}`}
							</h3>
							<p>
								{open
									? `Request deadline ${expiry(first.expires_at)}`
									: first.closed
										? "Quote selected"
										: "Request expired"}
							</p>
							{first.winning_deal && (
								<Link href={`/deals/${first.winning_deal}`}>
									Open accepted deal
								</Link>
							)}
							<button
								type="button"
								disabled={busy}
								onClick={() => run(() => review(invites))}
							>
								Decrypt request and quotes
							</button>
							{items?.[0] && (
								<p>
									{items[0].request.size} tokens · {items[0].request.quote} ·{" "}
									<span className="mono">{items[0].request.mint}</span>
								</p>
							)}
							{items?.map((item) => {
								const { invite, quote } = item;
								return (
									<div key={invite.dealer}>
										{own && <h4>{short(invite.dealer)}</h4>}
										{quote && invite.quote_expires_at ? (
											<>
												<p>
													{quote.price} {item.request.quote} per token · Seller
													receives {quote.netDisplay} {item.request.quote} after
													fees
												</p>
												<p>
													Trade deadline {expiry(invite.quote_expires_at)} ·
													Dealer funds not reserved
												</p>
												{own &&
													open &&
													Date.parse(invite.quote_expires_at) > Date.now() && (
														<button
															type="button"
															disabled={busy}
															onClick={() => run(() => accept(item))}
														>
															Sign and accept quote
														</button>
													)}
											</>
										) : invite.quote_id ? (
											<p>Quote could not be verified.</p>
										) : own ? (
											<p>Awaiting quote.</p>
										) : (
											open && (
												<form
													onSubmit={(event) =>
														run(() => submitQuote(event, item))
													}
												>
													<label>
														Price per token
														<input name="price" inputMode="decimal" required />
													</label>
													<label>
														Quote expiry (minutes)
														<input
															name="minutes"
															type="number"
															min="2"
															max="10080"
															defaultValue="60"
															required
														/>
													</label>
													<button type="submit" disabled={busy}>
														Sign and send quote
													</button>
												</form>
											)
										)}
									</div>
								);
							})}
						</article>
					);
				})}
			</section>
			{notice && <p role="status">{notice}</p>}
			{!liquidity && <Treasury address={address} />}
		</>
	);
}
