"use client";
import Link from "next/link";
import { useSession } from "../../providers";
import { QuoteWorkspace } from "./workspace";

export default function QuoteRoom() {
	const session = useSession();
	const address = session.account?.address;
	return (
		<section className="stack">
			<Link className="desk-back" href="/otc">
				← OTC desk
			</Link>
			<div className="desk-hero">
				<h1>Private quote room</h1>
				<p>
					Ask approved dealers to price a full block of tokens you want to sell.
					Only invited wallets can open the request.
				</p>
			</div>
			{session.token && address ? (
				<QuoteWorkspace key={address} address={address} />
			) : (
				<div className="panel board-state">
					<h2>Sign in to request quotes</h2>
					<p>
						Open <strong>Menu → Connect Solana Wallet</strong>, then unlock and
						sign in.
					</p>
				</div>
			)}
		</section>
	);
}
