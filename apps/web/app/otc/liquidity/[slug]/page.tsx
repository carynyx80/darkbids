"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, useSession } from "../../../providers";
import { type LiquidityPage, QuoteWorkspace } from "../../quotes/workspace";

const mainnetUsdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export default function ProjectLiquidity() {
	const { slug } = useParams<{ slug: string }>();
	const { account, token } = useSession();
	const [copied, setCopied] = useState("");
	const query = useQuery({
		queryKey: ["liquidity-page", slug],
		queryFn: () =>
			api<LiquidityPage>(`/otc/liquidity/${encodeURIComponent(slug)}`),
		retry: false,
		refetchInterval: 30_000,
	});
	const page = query.data;
	return (
		<section className="stack liquidity-layout">
			<Link className="desk-back" href="/otc/liquidity">
				← Liquidity pages
			</Link>
			{query.error && (
				<div className="panel board-state" role="alert">
					{query.error.message}
				</div>
			)}
			{query.isPending && (
				<div className="panel board-state" role="status">
					Loading liquidity page…
				</div>
			)}
			{page && (
				<>
					<div className="desk-hero liquidity-hero">
						<div className="stack">
							<h1>{page.name}</h1>
							{page.description && <p>{page.description}</p>}
						</div>
						<dl className="liquidity-metrics">
							<div>
								<dt>Quote currency</dt>
								<dd>{page.quote}</dd>
							</div>
							<div>
								<dt>Active dealers</dt>
								<dd>{page.active_dealers}</dd>
							</div>
						</dl>
					</div>
					<div className="panel mint-panel">
						<dl>
							<dt>Solana token mint</dt>
							<dd>
								<code>{page.mint}</code>
							</dd>
						</dl>
						<button
							type="button"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(page.mint);
									setCopied("Mint copied");
								} catch {
									setCopied("Select the mint address to copy it.");
								}
							}}
						>
							Copy mint
						</button>
						{copied && <span role="status">{copied}</span>}
					</div>
					{(page.mint !== mainnetUsdc || page.quote !== "SOL") && (
						<p className="desk-notice">
							You can request quotes for this pair. Mainnet settlement currently
							supports USDC sales for SOL.
						</p>
					)}
					{token && account ? (
						<QuoteWorkspace
							key={`${slug}:${account.address}`}
							address={account.address}
							liquidity={page}
						/>
					) : (
						<article className="panel stack quote-intro">
							<h2>Request a private quote</h2>
							<p>
								Enter the amount you want to sell. Participating dealers receive
								the encrypted request and can reply with a signed price.
							</p>
							{page.active_dealers ? (
								<p>
									Open <strong>Menu → Connect Solana Wallet</strong>, then sign
									in to request a quote.
								</p>
							) : (
								<p className="desk-notice">
									Quotes will be available when a dealer opts in. Invited
									dealers can connect from the menu to get started.
								</p>
							)}
						</article>
					)}
				</>
			)}
		</section>
	);
}
