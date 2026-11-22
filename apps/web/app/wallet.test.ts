import { expect, it } from "vitest";
import { type Account, solanaAccount } from "./wallet";

it("accepts signing-capable Solana accounts and prefers mainnet", () => {
	const account = (
		address: string,
		chains: string[],
		features = ["solana:signMessage"],
	): Account => ({ address, chains, features, publicKey: new Uint8Array(32) });
	const ethereum = account("ethereum", ["eip155:1"]);
	const unsupported = account("readonly", ["solana:mainnet"], []);
	const devnet = account("devnet", ["solana:devnet"]);
	const mainnet = account("mainnet", ["solana:mainnet", "eip155:1"]);
	expect(solanaAccount([ethereum, unsupported])).toBeUndefined();
	expect(solanaAccount([ethereum, devnet, mainnet])).toBe(mainnet);
	expect(solanaAccount([ethereum, devnet, mainnet], "devnet")).toBe(devnet);
	expect(solanaAccount([ethereum, devnet, mainnet], "ethereum")).toBe(mainnet);
});
