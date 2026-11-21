import Link from "next/link";

export default function Home() {
	return (
		<>
			<section className="hero" aria-labelledby="hero-title">
				<div className="hero-art" aria-hidden="true">
					<div className="hero-orbit" />
					<div className="hero-orb" />
				</div>
				<div className="hero-content">
					<p className="eyebrow">
						<span className="dot" /> Solana devnet preview
					</p>
					<h1 id="hero-title">
						Private offers
						<br />
						<em>for OTC trades.</em>
					</h1>
					<p>
						Browse Solana token listings and negotiate directly. Offer terms are
						encrypted in your browser.
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
			</section>
			<section className="home-details" aria-label="About this preview">
				<article>
					<h2>Negotiate in private</h2>
					<p>
						Make an encrypted offer and accept terms directly with the other
						party. Trade funding and settlement are unavailable in this preview.
					</p>
				</article>
				<article>
					<h2>Know what’s public</h2>
					<p>
						On-chain addresses and timing stay public. Public deposits and
						withdrawals also reveal the asset and amount.
					</p>
					<Link href="/docs">Read the guide</Link>
				</article>
			</section>
		</>
	);
}
