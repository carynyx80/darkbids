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
					<Link href="/#how-it-works" className="hero-guide">
						How it works <span aria-hidden="true">↓</span>
					</Link>
				</div>
			</section>
			<section
				className="how-it-works"
				id="how-it-works"
				aria-labelledby="how-it-works-title"
			>
				<h2 id="how-it-works-title">How it works</h2>
				<div className="home-details">
					<article className="feature-card">
						<h3>OTC board</h3>
						<ol>
							<li>Browse token listings or connect your wallet to post one.</li>
							<li>Send an encrypted offer for the seller to review.</li>
							<li>
								Once the seller accepts, both parties can sign the agreed terms.
							</li>
						</ol>
						<p>On-chain funding and settlement are pending.</p>
						<Link href="/otc">
							Explore listings <span aria-hidden="true">↗</span>
						</Link>
					</article>
					<article className="feature-card">
						<h3>Private vault</h3>
						<ol>
							<li>
								Connect your Solana wallet, unlock the vault, and sign in.
							</li>
							<li>Deposit SOL or native USDC on Solana mainnet.</li>
							<li>
								Send to a shielded receiving address or withdraw to a public
								wallet.
							</li>
						</ol>
						<p>
							Your wallet approves each transaction. Helius Privacy Rings powers
							the vault.
						</p>
						<Link href="/app">
							Go to vault <span aria-hidden="true">↗</span>
						</Link>
					</article>
				</div>
			</section>
			<section className="home-guide" aria-labelledby="home-guide-title">
				<div>
					<h2 id="home-guide-title">Before you connect</h2>
					<Link href="/docs">
						Read the vault guide <span aria-hidden="true">↗</span>
					</Link>
				</div>
				<div className="home-questions">
					<details>
						<summary>Which wallets can I use?</summary>
						<p>
							Connect a Solana Wallet Standard extension. Your wallet needs
							Solana v1 transaction signing to move funds.
						</p>
					</details>
					<details>
						<summary>What stays private in the vault?</summary>
						<p>
							Private sends hide the asset and amount. Addresses and timing
							remain public, and deposits and withdrawals reveal the asset and
							amount.
						</p>
					</details>
					<details>
						<summary>Can I settle an OTC trade?</summary>
						<p>
							You can browse listings, negotiate through encrypted offers, and
							accept an offer. On-chain trade funding and settlement are
							pending.
						</p>
					</details>
				</div>
			</section>
		</>
	);
}
