import Link from "next/link";
import { APP_NAME } from "@veil/core/config";
import "./styles.css";
import { MainNav } from "./main-nav";
import { Providers } from "./providers";

export const metadata = {
	title: APP_NAME,
	description: "Confidential OTC negotiation on Solana",
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
							{APP_NAME}
						</Link>
						<MainNav />
					</div>
				</header>
				<Providers>
					<main className="shell">{children}</main>
					<footer className="shell">
						<span>{APP_NAME}</span>
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
