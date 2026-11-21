import Link from "next/link";

export default function Home() {
	return (
		<>
			<section className="hero" aria-labelledby="hero-title">
				<div className="hero-art" aria-hidden="true" />
				<div className="hero-content">
					<p className="eyebrow">Private finance on Solana</p>
					<h1 id="hero-title">
						Trade talks.
						<br />
						<em>Kept private.</em>
					</h1>
					<p>
						Negotiate with encrypted OTC offers and move SOL and USDC through a
						vault powered by Helius Privacy Rings.
					</p>
					<div className="actions">
						<Link className="button primary" href="/app">
							Open vault <span aria-hidden="true">↗</span>
						</Link>
						<Link className="button hero-secondary" href="/otc">
							Browse OTC board
						</Link>
					</div>
				</div>
			</section>
			<section className="home-details" aria-label="Explore useparlo">
				<article>
					<h2>OTC board</h2>
					<p>
						Post listings, exchange encrypted offers, and agree on terms.
						On-chain settlement is pending.
					</p>
					<Link href="/otc">
						Explore listings <span aria-hidden="true">↗</span>
					</Link>
				</article>
				<article>
					<h2>Private vault</h2>
					<p>
						Deposit, send privately, and withdraw SOL or USDC on mainnet. Your
						wallet authorizes every transaction.
					</p>
					<Link href="/app">
						Go to vault <span aria-hidden="true">↗</span>
					</Link>
				</article>
			</section>
		</>
	);
}
