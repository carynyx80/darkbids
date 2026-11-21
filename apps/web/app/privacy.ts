import {
	buildDepositTransaction,
	buildTransferTransaction,
	buildWithdrawalTransaction,
	createSprClient,
	fetchAssetMetadata,
	getPrivateTokenBalances,
	getPrivateTransactions,
	LocalKeys,
	ShieldedAddress,
	ShieldedKeypair,
	SigningKey,
	SOL_MINT,
	syncWallet,
	Wallet,
} from "@heliuslabs/spr";
import {
	address,
	getBase64EncodedWireTransaction,
	getTransactionDecoder,
	getTransactionEncoder,
	signatureBytes,
	type Transaction,
} from "@solana/kit";
import { parseUnits } from "@veil/core/fees";
import { decode, encode } from "@veil/core/vault";
import type { Account, StandardWallet } from "./wallet";

export const network =
	process.env.NEXT_PUBLIC_VAULT_NETWORK ??
	process.env.NEXT_PUBLIC_NETWORK ??
	"devnet";
export const depositsEnabled =
	network !== "mainnet" &&
	process.env.NEXT_PUBLIC_ENABLE_TEST_DEPOSITS === "true";

const LOCAL_PROVER = "http://127.0.0.1:3001";
export const spendingEnabled =
	network !== "mainnet" &&
	process.env.NEXT_PUBLIC_ENABLE_TEST_SPENDS === "true";

const proofDisabled = async (): Promise<never> => {
	throw new Error("This client is read-only");
};

const readWithBackoff: typeof fetch = async (input, init) => {
	for (let attempt = 0; ; attempt += 1) {
		const response = await fetch(input, init);
		if (response.status !== 429 || attempt === 2) return response;
		await response.body?.cancel();
		await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
	}
};

export const proofNetworkFetch: typeof fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : String(input));
	if (url.origin === LOCAL_PROVER)
		throw new Error("Proof requests must be handled inside the browser");
	const request = new Request(input, init);
	if (request.method === "POST") {
		const body = await request.clone().text();
		if (/nullifierSecret|nullifier_secret|viewingKey|viewing_key/i.test(body)) {
			throw new Error("Key material cannot be sent to the network");
		}
	}
	return readWithBackoff(input, init);
};

export async function openPrivacy(seed: Uint8Array, token?: string) {
	let solanaRpcUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL || undefined;
	let indexerUrl: string | undefined;
	let transport = readWithBackoff;
	if (network === "mainnet") {
		if (!token) throw new Error("Sign in to read your mainnet vault");
		const apiOrigin = process.env.NEXT_PUBLIC_API_URL;
		if (!apiOrigin) throw new Error("Mainnet vault reads are not configured");
		const base = new URL("/vault/mainnet/", apiOrigin);
		solanaRpcUrl = new URL("rpc", base).href;
		indexerUrl = new URL("indexer", base).href;
		transport = (input, init) => {
			const request = new Request(input, init);
			const url = new URL(request.url);
			if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
				throw new Error("Mainnet vault request has an unexpected destination");
			const headers = new Headers(request.headers);
			headers.set("Authorization", `Bearer ${token}`);
			// A redirect could move sensitive request data to another service.
			return fetch(new Request(request, { headers, redirect: "error" }));
		};
	} else if (network === "devnet" && !solanaRpcUrl) {
		throw new Error("Devnet RPC is not configured");
	} else if (network === "localnet" && solanaRpcUrl) {
		throw new Error("Localnet uses the default loopback ports");
	} else if (network !== "devnet" && network !== "localnet") {
		throw new Error("Unsupported vault network");
	}
	const client = await createSprClient({
		solanaRpcUrl,
		indexerUrl,
		proverUrl: LOCAL_PROVER,
		fetch: transport,
	});
	const seedCopy = new Uint8Array(seed);
	const key = ShieldedKeypair.fromKeypair(
		SigningKey.fromEd25519Bytes(
			seedCopy as Parameters<typeof SigningKey.fromEd25519Bytes>[0],
		),
	);
	const identity = key.shieldedAddress();
	const keys = LocalKeys.fromKeypair(key, {
		prove: proofDisabled,
		proveMerge: proofDisabled,
	});
	const wallet = new Wallet({ identity });
	const lifetime = new AbortController();
	const context = { signal: lifetime.signal, timeoutMs: 600_000 };
	const ownerSigner = key.toSolanaSigner();
	type BrowserProver = InstanceType<
		typeof import("@heliuslabs/spr-web-prover").SprWebProver
	>;
	let prover: BrowserProver | undefined;

	function walletSigner(provider: StandardWallet, account: Account) {
		const signer = provider.features["solana:signTransaction"];
		const chain = `solana:${network}`;
		if (
			!signer?.supportedTransactionVersions.includes(1) ||
			!account.chains.includes(chain)
		) {
			throw new Error(
				`Connect a Wallet Standard account that supports version 1 transactions on ${network}`,
			);
		}
		return { signer, chain };
	}

	async function submit(
		transaction: Transaction,
		provider: StandardWallet,
		account: Account,
		progress: (label: string) => void,
	) {
		const { signer, chain } = walletSigner(provider, account);
		lifetime.signal.throwIfAborted();
		progress("Approve the transaction in your wallet");
		const wire = getTransactionEncoder().encode(transaction);
		const [signed] = await signer.signTransaction({
			account,
			chain,
			transaction: new Uint8Array(wire),
		});
		lifetime.signal.throwIfAborted();
		if (!signed) throw new Error("Wallet did not sign the transaction");
		const decoded = getTransactionDecoder().decode(signed.signedTransaction);
		if (
			decoded.messageBytes.length !== transaction.messageBytes.length ||
			!decoded.messageBytes.every(
				(byte, index) => byte === transaction.messageBytes[index],
			)
		)
			throw new Error("Wallet modified the transaction");
		if (!decoded.signatures[address(account.address)])
			throw new Error("Wallet did not return its signature");
		progress("Submitting to Solana");
		const signature = await client.solanaRpc
			.sendTransaction(
				getBase64EncodedWireTransaction({
					...decoded,
					signatures: {
						...transaction.signatures,
						...Object.fromEntries(
							Object.entries(decoded.signatures).filter(
								([, signature]) => signature !== null,
							),
						),
					},
				}),
				{ encoding: "base64" },
			)
			.send();
		progress("Waiting for confirmation");
		await client.confirmTransaction(signature, undefined, context);
		return signature;
	}

	return {
		shieldedAddress: encode(identity.toBytes()),
		destroy() {
			lifetime.abort();
			prover?.terminate();
			keys.destroy();
			key.destroy();
			seedCopy.fill(0);
		},
		async read() {
			await syncWallet({ client, wallet, keys }, context);
			const balances = await Promise.all(
				getPrivateTokenBalances(wallet).map(async (balance) => ({
					...balance,
					decimals: (await fetchAssetMetadata(client, balance.mint, context))
						.decimals,
				})),
			);
			return { balances, history: getPrivateTransactions(wallet) };
		},
		async deposit(
			provider: StandardWallet,
			account: Account,
			mint: string,
			value: string,
			progress: (label: string) => void,
		) {
			if (!depositsEnabled) throw new Error("Test deposits are disabled");
			walletSigner(provider, account);
			const asset = mint ? address(mint) : SOL_MINT;
			const decimals = (await fetchAssetMetadata(client, asset)).decimals;
			const feePayer = address(account.address);
			const tokenProgram =
				asset === SOL_MINT
					? undefined
					: (await client.getAccount(asset))?.owner;
			const transaction = await buildDepositTransaction({
				client,
				feePayer,
				asset,
				recipient: identity,
				amount: parseUnits(value, decimals),
				splTokenProgram: tokenProgram,
			});
			return submit(transaction, provider, account, progress);
		},
		async spend(
			kind: "send" | "withdraw",
			provider: StandardWallet,
			account: Account,
			mint: string,
			value: string,
			destination: string,
			progress: (label: string) => void,
		) {
			if (!spendingEnabled) throw new Error("Test spending is disabled");
			walletSigner(provider, account);
			const recipient =
				kind === "send"
					? ShieldedAddress.fromBytes(decode(destination))
					: address(destination);
			const asset = mint ? address(mint) : SOL_MINT;
			const { decimals } = await fetchAssetMetadata(client, asset, context);
			const amount = parseUnits(value, decimals);
			await syncWallet({ client, wallet, keys }, context);

			progress(
				"Preparing browser proof. The first run downloads proving keys.",
			);
			const { SprWebProver } = await import("@heliuslabs/spr-web-prover");
			lifetime.signal.throwIfAborted();
			prover ??= new SprWebProver({
				proverUrl: LOCAL_PROVER,
				threads: 0,
				fetch: proofNetworkFetch,
			});
			const localClient = await createSprClient({
				solanaRpcUrl,
				proverUrl: LOCAL_PROVER,
				proofDataSource: "client",
				fetch: prover.createFetch(),
			});
			const spendKeys = LocalKeys.fromKeypair(key, localClient.proofService);
			try {
				const params = {
					client: localClient,
					wallet,
					keys: spendKeys,
					feePayer: address(account.address),
					amount,
					asset,
				};
				const transaction =
					typeof recipient === "string"
						? await buildWithdrawalTransaction(
								{
									...params,
									recipient,
									splTokenProgram:
										asset === SOL_MINT
											? undefined
											: (await client.getAccount(asset, context))?.owner,
								},
								context,
							)
						: await buildTransferTransaction({ ...params, recipient }, context);
				const ownerSignature =
					transaction.signatures[ownerSigner.address] === null
						? {
								[ownerSigner.address]: signatureBytes(
									key.sign(new Uint8Array(transaction.messageBytes)),
								),
							}
						: {};
				return submit(
					{
						...transaction,
						signatures: { ...transaction.signatures, ...ownerSignature },
					},
					provider,
					account,
					progress,
				);
			} finally {
				spendKeys.destroy();
			}
		},
	};
}
