"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSession } from "./providers";

const links = [
	["Home", "/"],
	["How it works", "/#how-it-works"],
	["OTC board", "/otc"],
	["Vault", "/app"],
	["Create listing", "/otc/new"],
	["Guide", "/docs"],
	["Status", "/status"],
	["Burns", "/burns"],
	["Terms", "/terms"],
	["Privacy", "/privacy"],
] as const;

export function MainNav() {
	const path = usePathname();
	const { walletMenu } = useSession();
	const disclosure = useRef<HTMLDetailsElement>(null);
	const trigger = useRef<HTMLElement>(null);

	useEffect(() => {
		const menu = disclosure.current;
		if (!menu) return;
		menu.open = false;
		const closeOutside = (event: PointerEvent) => {
			if (event.target instanceof Node && !menu.contains(event.target))
				menu.open = false;
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !menu.open) return;
			menu.open = false;
			trigger.current?.focus();
		};
		document.addEventListener("pointerdown", closeOutside);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, []);

	return (
		<details className="menu-disclosure" ref={disclosure}>
			<summary className="menu-trigger" ref={trigger}>
				<span className="menu-glyph" aria-hidden="true">
					<span />
					<span />
					<span />
				</span>
				Menu
			</summary>
			<nav className="main-nav" aria-label="Primary">
				{walletMenu}
				{links.map(([label, href]) => (
					<Link
						key={href}
						href={href}
						aria-current={
							path === href ||
							(href === "/otc" &&
								((path.startsWith("/otc/") && path !== "/otc/new") ||
									path.startsWith("/deals/")))
								? "page"
								: undefined
						}
						onClick={() => {
							if (disclosure.current) disclosure.current.open = false;
						}}
					>
						{label}
					</Link>
				))}
			</nav>
		</details>
	);
}
