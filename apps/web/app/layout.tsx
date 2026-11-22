import { PUBLIC_SITE_ORIGIN } from "@veil/core/site";
import type { Metadata } from "next";
import "./styles.css";
import { SiteFrame } from "./site-frame";

const brandName = "Primar";

const title = "Primar | Solana OTC";
const description =
	"Request private OTC quotes, launch a Liquidity Page, and manage trades with treasury approvals and signed receipts. The private vault is powered by Helius Privacy Rings.";
const socialImage = "/brand/primar-social-preview-v1.jpg";
const socialAlt = "Primar is live. Private quotes. Solana OTC.";

export const metadata: Metadata = {
	title,
	metadataBase: new URL(PUBLIC_SITE_ORIGIN),
	description,
	icons: { icon: "/brand/primar-mark.png", apple: "/brand/primar-mark.png" },
	openGraph: {
		type: "website",
		siteName: brandName,
		url: PUBLIC_SITE_ORIGIN,
		title,
		description,
		images: [{ url: socialImage, width: 1200, height: 630, alt: socialAlt }],
	},
	twitter: {
		card: "summary_large_image",
		title,
		description,
		images: [{ url: socialImage, alt: socialAlt }],
	},
};

export default function Layout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en">
			<body>
				<a className="skip-link" href="#main-content">
					Skip to content
				</a>
				<SiteFrame brand={brandName}>{children}</SiteFrame>
			</body>
		</html>
	);
}
