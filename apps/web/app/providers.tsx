"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { authMessage } from "@veil/core/contracts";
import { z } from "zod";
import { encode } from "@veil/core/vault";
import {
	type Account,
	type StandardWallet,
	clearSeed,
	discoverWallets,
	rememberSeed,
	restoreSeed,
	signMessage,
	unlock,
} from "./wallet";

export async function api<T>(
	path: string,
	init?: RequestInit,
	token?: string,
): Promise<T> {
	const response = await fetch(
		`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}${path}`,
		{
			...init,
			cache: "no-store",
			headers: {
				...(init?.body ? { "Content-Type": "application/json" } : {}),
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		},
	);
	if (!response.ok) {
		const failure: { message?: string } = await response
			.json()
			.catch(() => ({}));
		throw new Error(failure.message ?? "Desk service is unavailable");
	}
	return response.json();
}

type Session = {
	wallet?: StandardWallet;
	account?: Account;
	seed?: Uint8Array<ArrayBuffer>;
	token?: string;
	lock(): void;
	authenticate(): Promise<void>;
};
const session = createContext<Session | undefined>(undefined);
export function useSession() {
	const state = useContext(session);
	if (!state) throw new Error("Wallet session is missing");
	return state;
}

export function Providers({ children }: { children: React.ReactNode }) {
	const [query] = useState(() => new QueryClient());
	const [wallets, setWallets] = useState<StandardWallet[]>([]);
	const [wallet, setWallet] = useState<StandardWallet>();
	const [account, setAccount] = useState<Account>();
	const [seed, setSeed] = useState<Uint8Array<ArrayBuffer>>();
	const [token, setToken] = useState<string>();
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const seedRef = useRef<Uint8Array<ArrayBuffer> | undefined>(undefined);
	const generation = useRef(0);
	function lock() {
		generation.current += 1;
		seedRef.current?.fill(0);
		seedRef.current = undefined;
		clearSeed();
		setSeed(undefined);
		setToken(undefined);
		query.clear();
	}
	useEffect(() => {
		const stop = discoverWallets((candidate) =>
			setWallets((previous) =>
				previous.some((item) => item.name === candidate.name)
					? previous
					: [...previous, candidate],
			),
		);
		const close = () => {
			generation.current += 1;
			clearSeed();
			seedRef.current?.fill(0);
			seedRef.current = undefined;
			setSeed(undefined);
			setToken(undefined);
			query.clear();
		};
		window.addEventListener("pagehide", close);
		return () => {
			stop();
			window.removeEventListener("pagehide", close);
		};
	}, [query]);
	useEffect(() =>
		wallet?.features["standard:events"]?.on("change", (event) => {
			if (
				!event.accounts ||
				event.accounts.some((item) => item.address === account?.address)
			)
				return;
			lock();
			setAccount(event.accounts[0]);
		}),
	);
	async function connect(candidate: StandardWallet) {
		setNotice("");
		setBusy(true);
		try {
			const result = await candidate.features["standard:connect"]?.connect();
			if (!result?.accounts[0])
				throw new Error("Wallet has no authorized account");
			if (account) lock();
			setWallet(candidate);
			setAccount(result.accounts[0]);
			const recovered = restoreSeed(result.accounts[0]);
			seedRef.current = recovered;
			setSeed(recovered);
		} catch (error) {
			setNotice(
				error instanceof Error ? error.message : "Wallet connection failed",
			);
		} finally {
			setBusy(false);
		}
	}
	async function authenticate() {
		if (!wallet || !account) return;
		setBusy(true);
		setNotice("");
		const attempt = generation.current;
		try {
			if (!seed) {
				const next = await unlock(wallet, account);
				if (generation.current !== attempt) {
					next.fill(0);
					return;
				}
				rememberSeed(account, next);
				seedRef.current = next;
				setSeed(next);
				return;
			}
			const challengeData = await api<unknown>("/auth/nonce", {
				method: "POST",
				body: JSON.stringify({ wallet: account.address }),
			});
			const challenge = z
				.strictObject({ nonce: z.uuid(), expiresAt: z.iso.datetime() })
				.parse(challengeData);
			const message = authMessage(
				window.location.origin,
				account.address,
				challenge.nonce,
				challenge.expiresAt,
			);
			const signature = await signMessage(
				wallet,
				account,
				new TextEncoder().encode(message),
			);
			const auth = await api<{ token: string }>("/auth/verify", {
				method: "POST",
				body: JSON.stringify({
					wallet: account.address,
					nonce: challenge.nonce,
					signature: encode(signature),
				}),
			});
			if (generation.current === attempt) setToken(auth.token);
		} catch (error) {
			setNotice(
				error instanceof Error ? error.message : "Wallet action failed",
			);
		} finally {
			setBusy(false);
		}
	}
	return (
		<QueryClientProvider client={query}>
			<session.Provider
				value={{ wallet, account, token, seed, lock, authenticate }}
			>
				<div className="wallet-strip">
					<div className="shell wallet-inner">
						{account ? (
							<>
								<span className="mono">
									{account.address.slice(0, 6)}…{account.address.slice(-5)}
								</span>
								<button
									type="button"
									onClick={authenticate}
									disabled={busy || Boolean(token)}
								>
									{token
										? "Desk session active"
										: seed
											? "Sign in to desk"
											: "Unlock vault"}
								</button>
								{token && (
									<button type="button" onClick={authenticate} disabled={busy}>
										Renew sign-in
									</button>
								)}
								<button
									type="button"
									onClick={() => {
										lock();
										setAccount(undefined);
										setWallet(undefined);
									}}
								>
									Disconnect
								</button>
							</>
						) : wallets.length ? (
							wallets.map((candidate) => (
								<button
									type="button"
									key={candidate.name}
									onClick={() => connect(candidate)}
									disabled={busy}
								>
									{candidate.name}
								</button>
							))
						) : (
							<span>
								Connect a Solana Wallet Standard extension to use the vault.
							</span>
						)}
						{notice && <span role="status">{notice}</span>}
					</div>
				</div>
				{children}
			</session.Provider>
		</QueryClientProvider>
	);
}
