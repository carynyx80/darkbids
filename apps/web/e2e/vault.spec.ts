import { generateKeyPairSync as generateNodeKeyPair } from "node:crypto";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { address, createSolanaRpc, lamports } from "@solana/kit";
import bs58 from "bs58";

const rpc = createSolanaRpc("http://127.0.0.1:8899");
const baseUrl = process.env.VEIL_E2E_URL ?? "http://127.0.0.1:4318";

async function setupWallet(browser: Browser) {
	const { privateKey } = generateNodeKeyPair("ed25519");
	const key = privateKey.export({ format: "jwk" });
	if (!key.x) throw new Error("Test wallet public key missing");
	const walletAddress = bs58.encode(Buffer.from(key.x, "base64url"));
	await rpc
		.requestAirdrop(address(walletAddress), lamports(1_000_000_000n))
		.send();
	const page = await browser.newPage();
	await page.addInitScript(
		({ key, walletAddress }) => {
			const signer = crypto.subtle.importKey("jwk", key, "Ed25519", false, [
				"sign",
			]);
			const publicKey = Uint8Array.from(
				atob((key.x ?? "").replaceAll("-", "+").replaceAll("_", "/")),
				(char) => char.charCodeAt(0),
			);
			const account = {
				address: walletAddress,
				publicKey,
				chains: ["solana:localnet"],
				features: ["solana:signMessage", "solana:signTransaction"],
			};
			const wallet = {
				name: "Test Wallet",
				features: {
					"standard:connect": {
						connect: async () => ({ accounts: [account] }),
					},
					"solana:signMessage": {
						signMessage: async ({
							message,
						}: {
							message: Uint8Array<ArrayBuffer>;
						}) => [
							{
								signature: new Uint8Array(
									await crypto.subtle.sign("Ed25519", await signer, message),
								),
								signedMessage: message,
							},
						],
					},
					"solana:signTransaction": {
						supportedTransactionVersions: [1],
						signTransaction: async ({
							transaction,
						}: {
							transaction: Uint8Array<ArrayBuffer>;
						}) => {
							const count = transaction[1];
							if (transaction[0] !== 0x81 || count < 1 || count > 2)
								throw new Error("Unexpected test transaction signer count");
							const bytes = new Uint8Array(transaction);
							const signature = await crypto.subtle.sign(
								"Ed25519",
								await signer,
								bytes.slice(0, bytes.length - count * 64),
							);
							bytes.set(new Uint8Array(signature), bytes.length - count * 64);
							return [{ signedTransaction: bytes }];
						},
					},
				},
			};
			window.dispatchEvent(
				new CustomEvent("wallet-standard:register-wallet", {
					detail: (registry: { register(wallet: unknown): void }) =>
						registry.register(wallet),
				}),
			);
			window.addEventListener("wallet-standard:app-ready", (event) => {
				(
					event as CustomEvent<{ register(wallet: unknown): void }>
				).detail.register(wallet);
			});
		},
		{ key, walletAddress },
	);
	await page.goto(`${baseUrl}/app`);
	await page.getByRole("button", { name: "Connect Solana Wallet" }).click();
	await page.getByRole("button", { name: "Test Wallet" }).click();
	await page.getByRole("button", { name: "Unlock vault" }).click();
	await page
		.locator("summary")
		.filter({ hasText: "Shielded receiving address" })
		.click();
	const shielded = await page.locator("details code").textContent();
	if (!shielded) throw new Error("Shielded receiving address unavailable");
	return { page, walletAddress, shielded };
}

async function transact(
	page: Page,
	label: string,
	amount: string,
	destination?: string,
) {
	const form = page
		.locator("form")
		.filter({ has: page.getByRole("heading", { name: label, exact: true }) });
	await form.getByLabel("Amount", { exact: true }).fill(amount);
	if (destination)
		await form
			.getByLabel(
				label === "Send"
					? "Shielded receiving address"
					: "Public wallet address",
			)
			.fill(destination);
	else await form.getByRole("checkbox").check();
	await form.getByRole("button", { name: /review/i }).click();
	const notice = page.locator("main [role=status]");
	await expect
		.poll(
			async () => {
				const value = await notice
					.textContent({ timeout: 1000 })
					.catch(() => "");
				return Boolean(
					value &&
						!/preparing transaction|preparing browser proof|approve the transaction|submitting to solana|waiting for confirmation/i.test(
							value,
						),
				);
			},
			{ timeout: 240_000 },
		)
		.toBe(true);
	await expect(notice).toContainText("Transaction confirmed", {
		timeout: 1000,
	});
}

test("deposit, confidential send, and withdraw with disposable localnet wallets", async ({
	browser,
}) => {
	test.setTimeout(550_000);
	const sender = await setupWallet(browser);
	const recipient = await setupWallet(browser);
	const unsafeRequests: string[] = [];
	for (const page of [sender.page, recipient.page]) {
		page.on("request", (request) => {
			if (
				new URL(request.url()).port === "3001" ||
				/nullifierSecret|nullifier_secret|viewingKey|viewing_key/i.test(
					request.postData() ?? "",
				)
			) {
				unsafeRequests.push(new URL(request.url()).pathname);
			}
		});
	}
	await transact(sender.page, "Deposit", "0.01");
	await transact(sender.page, "Send", "0.006", recipient.shielded);
	await transact(recipient.page, "Withdraw", "0.002", recipient.walletAddress);
	expect(unsafeRequests).toEqual([]);
});
