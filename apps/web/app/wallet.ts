import { vaultIdentityHost } from "@veil/core/site";
import { decode, deriveSeed, encode, vaultMessage } from "@veil/core/vault";
import bs58 from "bs58";
import nacl from "tweetnacl";

export type Account = {
	address: string;
	publicKey: Uint8Array;
	chains: readonly string[];
	features: readonly string[];
};
type FeatureMap = {
	"standard:connect": { connect(): Promise<{ accounts: readonly Account[] }> };
	"standard:events": {
		on(
			event: "change",
			listener: (event: { accounts?: readonly Account[] }) => void,
		): () => void;
	};
	"solana:signMessage": {
		signMessage(input: {
			account: Account;
			message: Uint8Array;
		}): Promise<
			readonly { signature: Uint8Array; signedMessage: Uint8Array }[]
		>;
	};
	"solana:signTransaction": {
		supportedTransactionVersions: readonly (number | "legacy")[];
		signTransaction(input: {
			account: Account;
			chain: string;
			transaction: Uint8Array;
		}): Promise<readonly { signedTransaction: Uint8Array }[]>;
	};
};
export type StandardWallet = { name: string; features: Partial<FeatureMap> };

export function solanaAccount(accounts: readonly Account[], current?: string) {
	const supported = accounts.filter(
		(account) =>
			account.chains.some((chain) => chain.startsWith("solana:")) &&
			account.features.includes("solana:signMessage"),
	);
	return (
		supported.find((account) => current && account.address === current) ??
		supported.find((account) => account.chains.includes("solana:mainnet")) ??
		supported[0]
	);
}

export function discoverWallets(listener: (wallet: StandardWallet) => void) {
	const api = {
		register: (...wallets: StandardWallet[]) => {
			for (const wallet of wallets)
				if (
					wallet.features["solana:signMessage"] &&
					wallet.features["standard:connect"]
				)
					listener(wallet);
			return () => {};
		},
	};
	const registration = (event: Event) =>
		(event as CustomEvent<(registry: typeof api) => void>).detail(api);
	window.addEventListener("wallet-standard:register-wallet", registration);
	window.dispatchEvent(
		new CustomEvent("wallet-standard:app-ready", { detail: api }),
	);
	return () =>
		window.removeEventListener("wallet-standard:register-wallet", registration);
}

export function clearSeed() {
	sessionStorage.removeItem("veil-vault");
}

export async function signMessage(
	wallet: StandardWallet,
	account: Account,
	message: Uint8Array,
) {
	const [output] =
		(await wallet.features["solana:signMessage"]?.signMessage({
			account,
			message,
		})) ?? [];
	const publicKey = bs58.decode(account.address);
	if (
		output?.signature.length !== 64 ||
		!nacl.sign.detached.verify(message, output.signature, publicKey)
	) {
		throw new Error("Wallet returned a signature for a different request");
	}
	return new Uint8Array(output.signature);
}

export function restoreSeed(account: Account) {
	const saved = sessionStorage.getItem("veil-vault");
	const prefix = `${account.address}.`;
	if (!saved?.startsWith(prefix)) {
		clearSeed();
		return undefined;
	}
	const seed = decode(saved.slice(prefix.length));
	if (seed.length !== 32) {
		clearSeed();
		return undefined;
	}
	return seed;
}

export async function unlock(wallet: StandardWallet, account: Account) {
	const host = vaultIdentityHost(window.location.host);
	const signature = await signMessage(
		wallet,
		account,
		vaultMessage(host, account.address),
	);
	try {
		return await deriveSeed(signature, host);
	} finally {
		signature.fill(0);
	}
}

export const rememberSeed = (account: Account, seed: Uint8Array) =>
	sessionStorage.setItem("veil-vault", `${account.address}.${encode(seed)}`);
