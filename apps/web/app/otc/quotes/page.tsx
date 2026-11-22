"use client";
import Link from "next/link";
import { useSession } from "../../providers";
import { QuoteWorkspace } from "./workspace";

export default function QuoteRoom() {
	const session = useSession();
	const address = session.account?.address;
	return (
		<section className="stack">
			<Link href="/otc">← OTC desk</Link>
			<h1>Private quote room</h1>
			<p>
				Ask approved dealers to price a full block of tokens you want to sell.
				Only invited wallets can open the request.
			</p>
			{session.token && address ? (
				<QuoteWorkspace key={address} address={address} />
			) : (
				<p>Connect your wallet, unlock it, and sign in to the desk.</p>
			)}
		</section>
	);
}
