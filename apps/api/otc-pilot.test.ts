import { SOL_MINT } from "@veil/core/config";
import { expect, it } from "vitest";
import { isPilotTrade, pilotWallets, USDC_MINT } from "./otc-pilot";

it("restricts the pilot to a specific wallet pair, direction, pair of mints and amount caps", () => {
	const seller = "3QBZ8hJbpFLiwredUnDJe7wzKA2HGf8onSoa3Wu2A5Dw";
	const buyer = "8wfNUw4SFJCZvC6N87M7s4sCzY4XUE4nUBJVWWTijngV";
	const wallets = pilotWallets.parse([seller, buyer]);
	const trade = {
		seller,
		buyer,
		assetMint: USDC_MINT,
		quoteMint: SOL_MINT,
		assetAmount: 1_000_000n,
		quoteAmount: 10_000_000n,
	};
	expect(isPilotTrade(wallets, trade)).toBe(true);
	expect(isPilotTrade(undefined, trade)).toBe(false);
	expect(
		isPilotTrade(wallets, { ...trade, seller: buyer, buyer: seller }),
	).toBe(false);
	expect(isPilotTrade(wallets, { ...trade, buyer: SOL_MINT })).toBe(false);
	expect(
		isPilotTrade(wallets, { ...trade, assetAmount: trade.assetAmount + 1n }),
	).toBe(false);
	expect(
		isPilotTrade(wallets, { ...trade, quoteAmount: trade.quoteAmount + 1n }),
	).toBe(false);
	expect(isPilotTrade(wallets, { ...trade, assetMint: SOL_MINT })).toBe(false);
	expect(isPilotTrade(wallets, { ...trade, quoteMint: USDC_MINT })).toBe(false);
	expect(pilotWallets.safeParse([seller, seller]).success).toBe(false);
});
