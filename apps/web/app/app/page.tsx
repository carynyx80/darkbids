"use client";
import { useEffect, useState } from "react";
import { formatAmount } from "@heliuslabs/spr";
import { api, useSession } from "../providers";
import { network, openPrivacy, spendingEnabled } from "../privacy";

type Privacy = Awaited<ReturnType<typeof openPrivacy>>;
type Snapshot = Awaited<ReturnType<Privacy["read"]>>;
const errorLabel = (error: unknown) =>
	error instanceof Error ? error.message : "Vault action failed";
const explorer = (signature: string) =>
	`https://solscan.io/tx/${signature}${network === "devnet" ? "?cluster=devnet" : ""}`;

export default function Dashboard() {
	const { seed, account, wallet, lock } = useSession();
	const [client, setClient] = useState<Privacy>();
	const [snapshot, setSnapshot] = useState<Snapshot>();
	const [notice, setNotice] = useState("");
	const [signature, setSignature] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let active = true;
		let loaded: Privacy | undefined;
		setClient(undefined);
		setSnapshot(undefined);
		setNotice("");
		setSignature("");
		setBusy(false);
		if (seed) {
			setBusy(true);
			void openPrivacy(seed)
				.then((next) => {
					if (!active) {
						next.destroy();
						return;
					}
					loaded = next;
					setClient(next);
					return next.read().then((state) => {
						if (active) setSnapshot(state);
					});
				})
				.catch((error) => {
					if (active) setNotice(errorLabel(error));
				})
				.finally(() => {
					if (active) setBusy(false);
				});
		}
		return () => {
			active = false;
			loaded?.destroy();
		};
	}, [seed]);

	async function refresh() {
		if (!client) return;
		setBusy(true);
		setNotice("Reading encrypted history");
		try {
			setSnapshot(await client.read());
			setNotice("Vault synced");
		} catch (error) {
			setNotice(errorLabel(error));
		} finally {
			setBusy(false);
		}
	}

	async function transact(
		kind: "deposit" | "send" | "withdraw",
		event: React.FormEvent<HTMLFormElement>,
	) {
		event.preventDefault();
		if (!client || !wallet || !account) return;
		const data = new FormData(event.currentTarget);
		const mint = String(data.get("mint")).trim();
		const amount = String(data.get("amount"));
		const destination = String(data.get("destination")).trim();
		setSignature("");
		setNotice("Preparing transaction");
		setBusy(true);
		try {
			if (network === "devnet") {
				const health = await api<{ network: string }>("/health");
				if (health.network !== network)
					throw new Error("Web and API networks differ");
			}
			const tx =
				kind === "deposit"
					? await client.deposit(wallet, account, mint, amount, setNotice)
					: await client.spend(
							kind,
							wallet,
							account,
							mint,
							amount,
							destination,
							setNotice,
						);
			setSignature(tx);
			setNotice("Transaction confirmed");
			await client
				.read()
				.then(setSnapshot)
				.catch(() =>
					setNotice("Transaction confirmed. Refresh to update balances."),
				);
		} catch (error) {
			setNotice(errorLabel(error));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="stack">
			<div className="section-head">
				<div className="eyebrow">{network.toUpperCase()} / DEFAULT RING</div>
				<h1>Private vault</h1>
				<p>View private balances and history on this device.</p>
			</div>
			{!seed ? (
				<div className="panel board-state">
					<h2>Your vault is locked</h2>
					<p>
						Connect and unlock your wallet to view private balances and history.
					</p>
				</div>
			) : (
				<>
					<div className="actions">
						<button type="button" disabled={!client || busy} onClick={refresh}>
							Refresh
						</button>
						<button type="button" onClick={lock} disabled={busy}>
							Lock vault
						</button>
					</div>
					<div className="grid two">
						<article className="panel">
							<h2>Balances</h2>
							{client && (
								<details>
									<summary>Shielded receiving address</summary>
									<code>{client.shieldedAddress}</code>
								</details>
							)}
							{snapshot ? (
								snapshot.balances.length ? (
									<ul className="rows">
										{snapshot.balances.map((balance) => (
											<li key={balance.mint}>
												<strong>
													{formatAmount(balance.amount, balance.decimals)}
												</strong>
												<code>{balance.mint}</code>
											</li>
										))}
									</ul>
								) : (
									<p>No private balances found.</p>
								)
							) : (
								<p>{busy ? "Syncing…" : "Balances unavailable."}</p>
							)}
						</article>
						<form
							className="panel stack"
							onSubmit={(event) => transact("deposit", event)}
						>
							<h2>Deposit</h2>
							<label>
								SPL mint (optional for SOL)
								<input name="mint" placeholder="SOL" />
							</label>
							<label>
								Amount
								<input
									name="amount"
									inputMode="decimal"
									required
									placeholder="0.00"
								/>
							</label>
							<div className="inline-note">
								<strong>What the chain sees</strong>
								<p>
									Sender, receiving address, timing, mint and deposited amount
									are public.
								</p>
							</div>
							<label className="check">
								<input type="checkbox" required /> I am using disposable test
								assets.
							</label>
							{process.env.NEXT_PUBLIC_ENABLE_TEST_DEPOSITS === "true" ? (
								<button
									className="primary"
									type="submit"
									disabled={!client || busy}
								>
									Review deposit
								</button>
							) : (
								<p>Test deposits are disabled in this environment.</p>
							)}
						</form>
					</div>
					{notice && (
						<div className="inline-note" role="status">
							{notice}{" "}
							{signature &&
								(network === "localnet" ? (
									<code>{signature}</code>
								) : (
									<a href={explorer(signature)}>View on Solscan</a>
								))}
						</div>
					)}
					<div className="grid two">
						{(["send", "withdraw"] as const).map((kind) => (
							<form
								className="panel stack"
								key={kind}
								onSubmit={(event) => transact(kind, event)}
							>
								<h2>{kind === "send" ? "Send" : "Withdraw"}</h2>
								<label>
									SPL mint (optional for SOL)
									<input name="mint" placeholder="SOL" />
								</label>
								<label>
									Amount
									<input name="amount" inputMode="decimal" required />
								</label>
								<label>
									{kind === "send"
										? "Shielded receiving address"
										: "Public wallet address"}
									<input name="destination" required />
								</label>
								<div className="inline-note">
									<strong>What the chain sees</strong>
									<p>
										{kind === "send"
											? "Addresses and timing are public. The asset and amount are encrypted."
											: "Sender, recipient, timing, mint and amount are public."}
									</p>
								</div>
								{spendingEnabled ? (
									<button type="submit" disabled={!client || busy}>
										Review transaction
									</button>
								) : (
									<p>Test spending is disabled in this environment.</p>
								)}
							</form>
						))}
					</div>
					<article className="panel">
						<h2>History</h2>
						{snapshot?.history.length ? (
							<ul className="rows">
								{snapshot.history.map((item) => (
									<li key={`${item.id.signature}-${item.id.index}`}>
										<strong>{item.kind}</strong>
										<span>
											{item.direction} · {item.status}
										</span>
										{network === "localnet" ? (
											<code>{item.id.signature}</code>
										) : (
											<a href={explorer(item.id.signature)}>View on Solscan</a>
										)}
									</li>
								))}
							</ul>
						) : (
							<p>
								{snapshot
									? "No private activity found."
									: "History unavailable."}
							</p>
						)}
					</article>
				</>
			)}
		</section>
	);
}
