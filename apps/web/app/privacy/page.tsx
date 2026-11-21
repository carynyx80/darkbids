export default function PrivacyPolicy() {
	return (
		<section className="stack">
			<div className="section-head">
				<h1>Privacy policy</h1>
				<p>Draft, needs lawyer review.</p>
			</div>
			<article className="panel">
				<h2>Desk data</h2>
				<p>
					The desk stores wallet addresses, listing and offer metadata, and
					encrypted terms. It uses temporary IP and wallet counters for rate
					limiting and downloads the OFAC SDN feed for exact address matching.
				</p>
				<h2>Vault data</h2>
				<p>
					The browser holds the vault derivation seed and decrypts private
					balances locally. RPC and indexer providers receive requests needed to
					submit deposits and retrieve encrypted records.
				</p>
			</article>
		</section>
	);
}
