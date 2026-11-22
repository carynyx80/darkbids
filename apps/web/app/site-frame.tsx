"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MainNav } from "./main-nav";
import { Providers } from "./providers";

export function SiteFrame({
	brand,
	children,
}: {
	brand: string;
	children: ReactNode;
}) {
	const workspace = usePathname() !== "/";
	return (
		<Providers>
			<div
				className={workspace ? "site-frame workspace" : "site-frame landing"}
			>
				<header className="site-header">
					<div className="shell topbar">
						<Link href="/" className="brand">
							<span className="brand-mark" aria-hidden="true" />
							{brand}
						</Link>
						<MainNav />
					</div>
				</header>
				<div className="site-content">
					<main className="shell" id="main-content">
						{children}
					</main>
					<footer className="shell">
						<Link href="/" className="brand">
							<span className="brand-mark" aria-hidden="true" />
							{brand}
						</Link>
						<nav aria-label="Resources">
							<Link href="/status">Status</Link>
							<Link href="/docs">Guide</Link>
							<Link href="/burns">Burns</Link>
							<Link href="/terms">Terms</Link>
							<Link href="/privacy">Privacy</Link>
						</nav>
					</footer>
				</div>
			</div>
		</Providers>
	);
}
