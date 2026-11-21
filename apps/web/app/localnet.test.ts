import {
	createSolanaRpc,
	generateKeyPairSigner,
	getAddressEncoder,
	getTransactionDecoder,
	getTransactionEncoder,
	lamports,
	signatureBytes,
} from "@solana/kit";
import { expect, test } from "vitest";
import type { Account, StandardWallet } from "./wallet";

test.runIf(process.env.VEIL_LOCALNET_TEST === "true")(
	"deposits local SOL and decrypts indexed balance",
	async () => {
		const rpc = createSolanaRpc("http://127.0.0.1:8899");
		const signer = await generateKeyPairSigner();
		await rpc.requestAirdrop(signer.address, lamports(1_000_000_000n)).send();
		for (let attempt = 0; attempt < 30; attempt += 1) {
			const balance = await rpc
				.getBalance(signer.address, { commitment: "confirmed" })
				.send();
			if (balance.value >= 1_000_000_000n) break;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		const account: Account = {
			address: signer.address,
			publicKey: new Uint8Array(getAddressEncoder().encode(signer.address)),
			chains: ["solana:localnet"],
			features: ["solana:signTransaction"],
		};
		const provider: StandardWallet = {
			name: "Localnet fixture",
			features: {
				"solana:signTransaction": {
					supportedTransactionVersions: [1],
					async signTransaction({ transaction }) {
						const decoded = getTransactionDecoder().decode(transaction);
						const raw = await crypto.subtle.sign(
							"Ed25519",
							signer.keyPair.privateKey,
							new Uint8Array(decoded.messageBytes),
						);
						const signedTransaction = getTransactionEncoder().encode({
							...decoded,
							signatures: {
								...decoded.signatures,
								[signer.address]: signatureBytes(new Uint8Array(raw)),
							},
						});
						return [{ signedTransaction: new Uint8Array(signedTransaction) }];
					},
				},
			},
		};
		const { openPrivacy } = await import("./privacy");
		const session = await openPrivacy(
			crypto.getRandomValues(new Uint8Array(32)),
		);
		try {
			const signature = await session.deposit(
				provider,
				account,
				"",
				"0.01",
				() => {},
			);
			expect(signature).toBeTruthy();
			const snapshot = await session.read();
			expect(snapshot.balances.map((entry) => entry.amount)).toContain(
				10_000_000n,
			);
			expect(
				snapshot.history.some((item) => item.id.signature === signature),
			).toBe(true);
		} finally {
			session.destroy();
		}
	},
	60_000,
);
