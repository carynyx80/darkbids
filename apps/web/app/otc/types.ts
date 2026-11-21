export interface Listing {
	id: string;
	seller: string;
	mint: string | null;
	category: string;
	bucket: string;
	quote: "SOL" | "USDC";
	expires_at: string;
	encryption_key: string;
}
export const short = (wallet: string) =>
	`${wallet.slice(0, 6)}…${wallet.slice(-5)}`;
export const expiry = (value: string) => new Date(value).toLocaleString();
