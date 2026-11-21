"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MainNav() {
	const path = usePathname();
	return (
		<nav className="main-nav" aria-label="Primary">
			<Link
				href="/otc"
				aria-current={
					path === "/otc" ||
					(path.startsWith("/otc/") && path !== "/otc/new") ||
					path.startsWith("/deals/")
						? "page"
						: undefined
				}
			>
				OTC board
			</Link>
			<Link href="/app" aria-current={path === "/app" ? "page" : undefined}>
				Vault
			</Link>
			<Link
				className="nav-cta"
				href="/otc/new"
				aria-current={path === "/otc/new" ? "page" : undefined}
			>
				Create listing
			</Link>
		</nav>
	);
}
