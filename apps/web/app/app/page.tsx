"use client";
import { useEffect, useState } from "react";
import { formatAmount } from "@heliuslabs/spr";
import { api, useSession } from "../providers";
import { network, openPrivacy } from "../privacy";

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

	async function deposit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!client || !wallet || !account) return;
		const data = new FormData(event.currentTarget);
		setSignature("");
		setBusy(true);
		try {
			if (network === "devnet") {
				const health = await api<{ network: string }>("/health");
				if (health.network !== network)
					throw new Error("Web and API networks differ");
			}
			const tx = await client.deposit(
				wallet,
				account,
				String(data.get("mint")).trim(),
				String(data.get("amount")),
				setNotice,
			);
			setSignature(tx);
			setNotice("Deposit confirmed");
			await client
				.read()
				.then(setSnapshot)
				.catch(() =>
					setNotice("Deposit confirmed. Refresh to update balances."),
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
				<div className="panel">
					Connect and unlock your wallet above to open the vault.
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
						<form className="panel stack" onSubmit={deposit}>
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
								<input type="checkbox" required /> I am using test assets and
								understand withdrawal is unavailable in this build.
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
						<article className="panel">
							<h2>Send</h2>
							<p>Unavailable while browser-only proving is pending.</p>
							<div className="inline-note">
								<strong>What the chain sees</strong>
								<p>
									Addresses and timing are public. The asset and amount are
									encrypted.
								</p>
							</div>
						</article>
						<article className="panel">
							<h2>Withdraw</h2>
							<p>Unavailable while browser-only proving is pending.</p>
							<div className="inline-note">
								<strong>What the chain sees</strong>
								<p>Sender, recipient, timing, mint and amount are public.</p>
							</div>
						</article>
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
