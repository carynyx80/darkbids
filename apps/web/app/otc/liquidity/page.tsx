"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { api, useSession } from "../../providers";
import { errorText, post } from "../workflows";

type ManagedPage = {
	slug: string;
	name: string;
	description: string;
	mint: string;
	quote: "SOL" | "USDC";
	dealers: string[];
	active: boolean;
};

export default function LiquidityPages() {
	const { account, token } = useSession();
	return (
		<section className="stack">
			<Link href="/otc">← OTC desk</Link>
			<div className="section-head">
				<h1>Liquidity pages</h1>
				<p>
					Create a shareable page where token holders can request private quotes
					from participating dealers.
				</p>
			</div>
			{account && token ? (
				<ManagePages
					key={account.address}
					wallet={account.address}
					token={token}
				/>
			) : (
				<p>Connect your wallet and sign in to create or manage a page.</p>
			)}
		</section>
	);
}

function ManagePages({ wallet, token }: { wallet: string; token: string }) {
	const [selected, setSelected] = useState<ManagedPage>();
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const query = useQuery({
		queryKey: ["managed-liquidity", wallet],
		queryFn: () =>
			api<{ pages: ManagedPage[] }>("/otc/liquidity", undefined, token),
		retry: false,
	});
	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const fields = new FormData(event.currentTarget);
		const slug = String(fields.get("slug")).trim().toLowerCase();
		setBusy(true);
		setNotice("");
		try {
			await api(
				"/otc/liquidity",
				post({
					slug,
					name: fields.get("name"),
					description: fields.get("description"),
					mint: String(fields.get("mint")).trim(),
					quote: fields.get("quote"),
					dealers: String(fields.get("dealers"))
						.split(/[\s,]+/)
						.filter(Boolean),
					active: fields.has("active"),
				}),
				token,
			);
			const result = await query.refetch({ throwOnError: true });
			setSelected(result.data?.pages.find((page) => page.slug === slug));
			setNotice(
				`Saved. Share ${window.location.origin}/otc/liquidity/${slug} with invited dealers so they can opt in.`,
			);
		} catch (error) {
			setNotice(errorText(error));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			{query.error && <p role="alert">{query.error.message}</p>}
			{query.data?.pages.length ? (
				<section className="panel stack">
					<h2>Your pages</h2>
					{query.data.pages.map((page) => (
						<div key={page.slug} className="split">
							{page.active ? (
								<Link href={`/otc/liquidity/${page.slug}`}>{page.name}</Link>
							) : (
								<span>{page.name} · unpublished</span>
							)}
							<button type="button" onClick={() => setSelected(page)}>
								Edit {page.name}
							</button>
						</div>
					))}
					<button type="button" onClick={() => setSelected(undefined)}>
						New page
					</button>
				</section>
			) : null}
			<form
				key={selected?.slug ?? "new"}
				className="panel stack"
				onSubmit={save}
			>
				<h2>{selected ? "Edit liquidity page" : "Create a liquidity page"}</h2>
				<label>
					Project name
					<input
						name="name"
						required
						minLength={2}
						maxLength={64}
						defaultValue={selected?.name}
					/>
				</label>
				<label>
					Page URL slug
					<input
						name="slug"
						required
						pattern="[a-z0-9]+(-[a-z0-9]+)*"
						minLength={3}
						maxLength={48}
						defaultValue={selected?.slug}
						readOnly={Boolean(selected)}
					/>
				</label>
				<label>
					Description
					<textarea
						name="description"
						maxLength={280}
						defaultValue={selected?.description}
					/>
				</label>
				<label>
					Token mint
					<input
						name="mint"
						required
						defaultValue={selected?.mint}
						readOnly={Boolean(selected)}
					/>
				</label>
				<label htmlFor="liquidity-quote">
					Quote currency
					{selected ? (
						<input
							id="liquidity-quote"
							name="quote"
							readOnly
							value={selected.quote}
						/>
					) : (
						<select id="liquidity-quote" name="quote">
							<option>SOL</option>
							<option>USDC</option>
						</select>
					)}
				</label>
				<label>
					Invited dealer wallets (up to five)
					<textarea
						name="dealers"
						required
						defaultValue={selected?.dealers.join("\n")}
					/>
				</label>
				<label>
					<input
						type="checkbox"
						name="active"
						defaultChecked={selected?.active ?? true}
					/>
					Publish page
				</label>
				<button type="submit" disabled={busy}>
					Save page
				</button>
			</form>
			{notice && <p role="status">{notice}</p>}
		</>
	);
}
