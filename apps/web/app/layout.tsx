import Link from "next/link";
import "./styles.css";
import { MainNav } from "./main-nav";
import { Providers } from "./providers";

const brandName = "lethe";

export const metadata = {
	title: brandName,
	description:
		"Encrypted OTC offers and a private Solana vault for SOL and USDC.",
	icons: { icon: "/icon.png", apple: "/brand/leveil-mark.png" },
};
export default function Layout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			<body>
				<header>
					<div className="shell topbar">
						<Link href="/" className="brand">
							<span className="brand-mark" aria-hidden="true" />
							{brandName}
						</Link>
						<MainNav />
					</div>
				</header>
				<Providers>
					<main className="shell">{children}</main>
					<footer className="shell">
						<Link href="/" className="brand">
							<span className="brand-mark" aria-hidden="true" />
							{brandName}
						</Link>
						<nav aria-label="Resources">
							<Link href="/status">Status</Link>
							<Link href="/docs">Guide</Link>
							<Link href="/burns">Burns</Link>
							<Link href="/terms">Terms</Link>
							<Link href="/privacy">Privacy</Link>
						</nav>
					</footer>
				</Providers>
			</body>
		</html>
	);
}
