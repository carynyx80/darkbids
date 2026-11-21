import Link from 'next/link';

export default function Guide() {
  return <section className="stack"><div className="section-head"><h1>Using the desk</h1></div>
    <article className="panel stack"><h2>Unlock the vault</h2><p>Connect a Solana Wallet Standard account and sign the domain-bound unlock message. Sign a separate, short-lived challenge to use the OTC API.</p><Link href="/app">Open vault</Link></article>
    <article className="panel stack"><h2>Negotiate</h2><p>Publish a size bucket and quote asset. The browser encrypts exact size and price before publishing. A buyer can send an encrypted offer, which the seller can decrypt and accept.</p><Link href="/otc">Open OTC board</Link></article>
    <article className="panel stack"><h2>Transaction support</h2><p>Wallets must support version 1 on the selected network to sign a deposit. Send, withdrawal, deal funding and settlement are unavailable in this build.</p></article>
  </section>;
}
