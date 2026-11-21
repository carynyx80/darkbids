import "./styles.css";
import { SiteFrame } from "./site-frame";

const brandName = "useparlo";

export const metadata = {
	title: brandName,
	description:
		"Encrypted OTC offers and a private Solana vault for SOL and USDC.",
	icons: { icon: "/icon.png", apple: "/brand/useparlo-mark.png" },
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
