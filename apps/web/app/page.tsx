import Link from "next/link";
import { APP_NAME } from "@veil/core/config";

export default function Home() {
	return (
		<>
			<section className="hero">
				<div className="hero-content">
					<div className="eyebrow">
						<span className="dot" /> SOLANA DEVNET
					</div>
					<h1>
						Large trades.
						<br />
						<em>Private terms.</em>
					</h1>
					<p>
						{APP_NAME} is a Solana OTC workspace for encrypted offers and a
						locally decrypted vault. Trade funding and settlement are currently
						unavailable.
					</p>
					<div className="actions">
						<Link className="button primary" href="/otc">
							Explore the board
						</Link>
						<Link className="button" href="/app">
							Open your vault
						</Link>
					</div>
				</div>
				<div className="rings" aria-hidden="true">
					<span />
					<span />
					<span />
					<span />
				</div>
			</section>
			<section className="grid two">
				<article className="panel">
					<div className="eyebrow">DEFAULT RING</div>
					<h2>What the chain sees</h2>
					<p>
						Confidential transfers hide the asset and amount. Addresses and
						transaction timing stay public. Deposits and withdrawals also expose
						the asset and amount.
					</p>
				</article>
				<article className="panel">
					<div className="eyebrow">DESK FEES</div>
					<h2>0.5% of the quote</h2>
					<p>
						The planned settlement fee is 0.5%. A public 0.02 SOL listing fee is
						planned. The devnet negotiation board currently charges neither fee.
					</p>
				</article>
			</section>
		</>
	);
}
