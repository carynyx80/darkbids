"use client";
import { buckets, categories, quotes } from "@veil/core/config";
import { listingInput, termsInput } from "@veil/core/contracts";
import { vaultIdentityHost } from "@veil/core/site";
import { dealEncryptionKey, encode, sealTerms } from "@veil/core/vault";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api, useSession } from "../../providers";

type Fields = {
	mint: string;
	size: string;
	price: string;
	minimumFill: string;
	hideMint: boolean;
	category: string;
	quote: string;
	bucket: string;
	hours: number;
};

export default function NewListing() {
	const { seed, token } = useSession();
	const router = useRouter();
	const { register, handleSubmit, formState } = useForm<Fields>();
	const [notice, setNotice] = useState("");
	async function create(values: Fields) {
		if (!seed || !token) return;
		setNotice("");
		try {
			const terms = termsInput.parse({
				mint: values.mint,
				size: values.size,
				price: values.price,
				quote: values.quote,
				minimumFill: values.minimumFill || undefined,
			});
			const keys = await dealEncryptionKey(
				seed,
				vaultIdentityHost(window.location.host),
			);
			try {
				const payload = listingInput.parse({
					mint: values.hideMint ? null : terms.mint,
					category: values.category,
					bucket: values.bucket,
					quote: terms.quote,
					expiresAt: new Date(
						Date.now() + values.hours * 3600_000,
					).toISOString(),
					encryptionKey: encode(keys.publicKey),
					ciphertext: sealTerms(JSON.stringify(terms), keys.publicKey),
				});
				const result = await api<{ id: string }>(
					"/listings",
					{ method: "POST", body: JSON.stringify(payload) },
					token,
				);
				router.push(`/otc/${result.id}`);
			} finally {
				keys.secretKey.fill(0);
			}
		} catch (error) {
			setNotice(
				error instanceof Error && error.name !== "ZodError"
					? error.message
					: "Check the mint, amount, asking price and expiry.",
			);
		}
	}
	return (
		<section className="stack">
			<div className="section-head">
				<h1>Create listing</h1>
				<p>
					The board shows the size bucket. Your exact terms are encrypted in the
					browser.
				</p>
			</div>
			<form className="panel stack form-width" onSubmit={handleSubmit(create)}>
				{(!seed || !token) && <p>Unlock your vault and sign in to publish.</p>}
				<label>
					Token mint
					<input required {...register("mint")} />
				</label>
				<label className="check">
					<input type="checkbox" {...register("hideMint")} /> Hide mint on the
					board
				</label>
				<div className="grid two">
					<label>
						Category
						<select {...register("category")}>
							{categories.map((item) => (
								<option key={item}>{item}</option>
							))}
						</select>
					</label>
					<label>
						Estimated USD size bucket
						<select {...register("bucket")}>
							{buckets.map((item) => (
								<option key={item}>{item}</option>
							))}
						</select>
					</label>
				</div>
				<div className="grid two">
					<label>
						Exact size
						<input required inputMode="decimal" {...register("size")} />
					</label>
					<label>
						Minimum fill (optional)
						<input inputMode="decimal" {...register("minimumFill")} />
					</label>
				</div>
				<div className="grid two">
					<label>
						Asking price per token
						<input required inputMode="decimal" {...register("price")} />
					</label>
					<label>
						Quote asset
						<select {...register("quote")}>
							{quotes.map((item) => (
								<option key={item}>{item}</option>
							))}
						</select>
					</label>
				</div>
				<label>
					Expiry in hours
					<input
						required
						type="number"
						min="1"
						max="168"
						defaultValue="24"
						{...register("hours", { valueAsNumber: true })}
					/>
				</label>
				<button
					className="primary"
					type="submit"
					disabled={!seed || !token || formState.isSubmitting}
				>
					Publish listing
				</button>
				{notice && <p role="alert">{notice}</p>}
			</form>
		</section>
	);
}
