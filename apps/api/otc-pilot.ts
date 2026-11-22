import { SOL_MINT } from "@veil/core/config";
import { walletAddress } from "@veil/core/contracts";
import { z } from "zod";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const pilotWallets = z
	.tuple([walletAddress, walletAddress])
	.refine(
		([seller, buyer]) => seller !== buyer,
		"Pilot wallets must be distinct",
	);

type Wallets = z.infer<typeof pilotWallets>;
type Parties = { seller: string; buyer: string };
type Trade = Parties & {
	assetMint: string;
	quoteMint: string;
	assetAmount: bigint;
	quoteAmount: bigint;
};

export function isPilotDeal(wallets: Wallets | undefined, parties: Parties) {
	return wallets?.[0] === parties.seller && wallets?.[1] === parties.buyer;
}

export function isPilotTrade(wallets: Wallets | undefined, trade: Trade) {
	return isPilotDeal(wallets, trade) && isBetaTrade(trade);
}

export function isBetaTrade(trade: Omit<Trade, keyof Parties>) {
	return (
		trade.assetMint === USDC_MINT &&
		trade.quoteMint === SOL_MINT &&
		trade.assetAmount > 0n &&
		trade.assetAmount <= 1_000_000n &&
		trade.quoteAmount > 0n &&
		trade.quoteAmount <= 10_000_000n
	);
}
