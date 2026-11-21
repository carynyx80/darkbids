export const APP_NAME = "Darkbid";
export const PLATFORM_FEE_BPS = 50n;
export const LISTING_FEE_LAMPORTS = 20_000_000n;
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const categories = ["Graduated token", "Large cap", "Stable"] as const;
export const buckets = [
	"Under $1k",
	"$1k–$10k",
	"$10k–$100k",
	"$100k+",
] as const;
export const quotes = ["USDC", "SOL"] as const;
