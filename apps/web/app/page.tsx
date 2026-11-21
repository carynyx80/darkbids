import Link from "next/link";
import { APP_NAME } from "@veil/core/config";

export default function Home() {
	return (
		<>
			<section className="hero" aria-labelledby="hero-title">
				<div className="hero-content">
					<p className="eyebrow">
						<span className="dot" /> Solana devnet preview
					</p>
					<h1 id="hero-title">
						Private offers
						<br />
						for <em>OTC trades.</em>
					</h1>
					<p>
						Browse token listings and negotiate directly. {APP_NAME} encrypts
						offer terms in your browser.
					</p>
					<div className="actions">
						<Link className="button primary" href="/otc">
							Browse listings
						</Link>
						<Link className="button secondary" href="/app">
							Open vault
						</Link>
					</div>
				</div>
				<div className="hero-art" aria-hidden="true">
					<span className="hero-orb" />
				</div>
			</section>
			<section className="home-details" aria-label="About this preview">
				<article>
					<h2>Who can see what?</h2>
					<p>
						Offer terms are encrypted. On-chain addresses and timing stay
						public, and public deposits and withdrawals expose the asset and
						amount.
					</p>
				</article>
				<article>
					<h2>Try the negotiation flow</h2>
					<p>
						Create a listing, make an offer, and accept terms. Trade funding and
						settlement are unavailable in this preview.
					</p>
				</article>
			</section>
		</>
	);
}
