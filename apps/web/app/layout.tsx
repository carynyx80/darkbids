import Link from 'next/link';
import { APP_NAME } from '@veil/core/config';
import './styles.css';
import { Providers } from './providers';

export const metadata = { title: APP_NAME, description: 'Confidential OTC negotiation on Solana' };
export default function Layout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body><Providers>
    <header><div className="shell topbar"><Link href="/" className="brand"><i aria-hidden />{APP_NAME}</Link>
      <nav aria-label="Primary"><Link href="/otc">OTC board</Link><Link href="/app">Vault</Link><Link href="/status">Status</Link></nav>
    </div></header>
    <main className="shell">{children}</main>
    <footer className="shell"><span>{APP_NAME} / Solana devnet workspace</span><nav aria-label="Resources">
      <Link href="/docs">Guide</Link><Link href="/burns">Burns</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link>
    </nav></footer>
  </Providers></body></html>;
}
