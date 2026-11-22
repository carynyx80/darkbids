"use client";

import {
	receiptMessage,
	signedReceipt,
	validWalletSignature,
} from "@veil/core/otc-workflows";
import Link from "next/link";
import { type ChangeEvent, useState } from "react";
import type { z } from "zod";

export default function VerifyReceipt() {
	const [receipt, setReceipt] = useState<z.infer<typeof signedReceipt>>();
	const [notice, setNotice] = useState("");
	async function verify(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		setReceipt(undefined);
		setNotice("");
		if (!file) return;
		try {
			if (file.size > 16_384) throw new Error();
			const parsed = signedReceipt.parse(JSON.parse(await file.text()));
			if (
				!validWalletSignature(
					parsed.statement.signer,
					parsed.signature,
					receiptMessage(parsed.statement),
				)
			)
				throw new Error();
			setReceipt(parsed);
		} catch {
			setNotice("This file is invalid or its wallet signature does not match.");
		}
	}
	return (
		<section className="stack">
			<Link href="/otc">← OTC desk</Link>
			<h1>Verify a trade receipt</h1>
			<div className="panel stack">
				<p>Your browser verifies the wallet signature locally.</p>
				<label>
					Receipt file
					<input
						type="file"
						accept=".json,application/json"
						onChange={verify}
					/>
				</label>
				{notice && <p role="alert">{notice}</p>}
				{receipt && (
					<>
						<h2>Valid wallet signature</h2>
						<p>
							Signed by <span className="mono">{receipt.statement.signer}</span>
						</p>
						<p>
							Deal <span className="mono">{receipt.statement.deal}</span>
						</p>
						<dl>
							{Object.entries(receipt.statement.details).map(
								([field, value]) => (
									<div key={field}>
										<dt>{field}</dt>
										<dd>{value}</dd>
									</div>
								),
							)}
						</dl>
						<a
							href={`https://solscan.io/tx/${receipt.statement.transaction}`}
							target="_blank"
							rel="noreferrer"
						>
							Check the transaction on Solscan
						</a>
					</>
				)}
			</div>
		</section>
	);
}
