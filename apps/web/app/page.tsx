import Link from "next/link";

export default function Home() {
	return (
		<>
			<section className="hero" aria-labelledby="hero-title">
				<div className="hero-content">
					<p className="eyebrow">Private OTC desk on Solana</p>
					<h1 id="hero-title">
						Make the deal
						<br />
						<em>in private.</em>
					</h1>
					<p>
						Find counterparties, negotiate through encrypted offers, and manage
						SOL and USDC in your private vault.
					</p>
					<div className="actions">
						<Link className="button primary" href="/otc">
							Browse listings <span aria-hidden="true">↗</span>
						</Link>
						<Link className="button" href="/app">
							Open vault
						</Link>
					</div>
				</div>
				<div className="hero-art" aria-hidden="true" />
			</section>
			<section className="home-details" aria-label="Desk and vault">
				<article>
					<h2>OTC desk</h2>
					<p>
						Post listings, exchange encrypted offers, and accept terms directly
						with your counterparty. On-chain trade settlement is pending.
					</p>
					<Link href="/otc/new">
						Create a listing <span aria-hidden="true">↗</span>
					</Link>
				</article>
				<article>
					<h2>Private vault</h2>
					<p>
						Deposit, send privately, and withdraw SOL or USDC on Solana mainnet.
						Your wallet authorizes each transaction.
					</p>
					<Link href="/docs">
						See how privacy works <span aria-hidden="true">↗</span>
					</Link>
				</article>
			</section>
		</>
	);
}
