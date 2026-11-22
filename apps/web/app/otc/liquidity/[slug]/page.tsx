"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, useSession } from "../../../providers";
import { type LiquidityPage, QuoteWorkspace } from "../../quotes/workspace";

const mainnetUsdc = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export default function ProjectLiquidity() {
	const { slug } = useParams<{ slug: string }>();
	const { account, token } = useSession();
	const query = useQuery({
		queryKey: ["liquidity-page", slug],
		queryFn: () =>
			api<LiquidityPage>(`/otc/liquidity/${encodeURIComponent(slug)}`),
		retry: false,
	});
	const page = query.data;
	return (
		<section className="stack">
			<Link href="/otc/liquidity">← Liquidity pages</Link>
			{query.error && <p role="alert">{query.error.message}</p>}
			{query.isPending && <p>Loading liquidity page…</p>}
			{page && (
				<>
					<header className="section-head">
						<h1>{page.name}</h1>
						{page.description && <p>{page.description}</p>}
						<p>
							Token mint <span className="mono">{page.mint}</span>
						</p>
						<p>
							Quotes in {page.quote} · {page.active_dealers} opted-in dealers
						</p>
					</header>
					<p>
						Primar routes your encrypted request to participating dealers for
						this page.
					</p>
					{(page.mint !== mainnetUsdc || page.quote !== "SOL") && (
						<p>
							Quotes are available for this pair. Mainnet settlement currently
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
						<p>
							Connect your wallet, unlock it, and sign in to request a quote or
							opt in as an invited dealer.
						</p>
					)}
				</>
			)}
		</section>
	);
}
