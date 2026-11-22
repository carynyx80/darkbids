"use client";
import { useQuery } from "@tanstack/react-query";
import { categories, quotes } from "@veil/core/config";
import Link from "next/link";
import { useState } from "react";
import { api } from "../providers";
import { expiry, type Listing, short } from "./types";

export default function Board() {
	const [category, setCategory] = useState("");
	const [quote, setQuote] = useState("");
	const [sort, setSort] = useState("newest");
	const [page, setPage] = useState(1);
	const params = new URLSearchParams({ page: String(page), sort });
	if (category) params.set("category", category);
	if (quote) params.set("quote", quote);
	const query = useQuery({
		queryKey: ["listings", params.toString()],
		queryFn: () =>
			api<{ items: Listing[]; hasNext: boolean }>(`/listings?${params}`),
		refetchInterval: 15_000,
		retry: false,
	});
	return (
		<section className="stack board">
			<div className="section-head split">
				<div>
					<h1>OTC board</h1>
					<p>Browse token listings and make encrypted offers.</p>
				</div>
				<div className="split">
					<Link href="/otc/quotes" className="button">
						Private quote room
					</Link>
					<Link href="/otc/new" className="button primary">
						Create listing
					</Link>
				</div>
			</div>
			<div className="panel filters">
				<label>
					Category
					<select
						value={category}
						onChange={(event) => {
							setCategory(event.target.value);
							setPage(1);
						}}
					>
						<option value="">All categories</option>
						{categories.map((item) => (
							<option key={item}>{item}</option>
						))}
					</select>
				</label>
				<label>
					Quote
					<select
						value={quote}
						onChange={(event) => {
							setQuote(event.target.value);
							setPage(1);
						}}
					>
						<option value="">All quotes</option>
						{quotes.map((item) => (
							<option key={item}>{item}</option>
						))}
					</select>
				</label>
				<label>
					Sort by
					<select
						value={sort}
						onChange={(event) => {
							setSort(event.target.value);
							setPage(1);
						}}
					>
						<option value="newest">Newest</option>
						<option value="expiry">Ending soon</option>
					</select>
				</label>
			</div>
			{query.isPending ? (
				<div className="panel board-state" role="status">
					Loading listings…
				</div>
			) : query.isError ? (
				<div className="panel split">
					<span role="alert">{query.error.message}</span>
					<button type="button" onClick={() => query.refetch()}>
						Retry
					</button>
				</div>
			) : query.data.items.length ? (
				<div className="listing-grid">
					{query.data.items.map((item) => (
						<article className="panel stack listing-card" key={item.id}>
							<div className="split">
								<h2>{item.category}</h2>
								<span className="tag">{item.quote}</span>
							</div>
							{item.mint && <code>{item.mint}</code>}
							<dl>
								<div>
									<dt>Size</dt>
									<dd>{item.bucket}</dd>
								</div>
								<div>
									<dt>Seller</dt>
									<dd>{short(item.seller)}</dd>
								</div>
								<div>
									<dt>Expires</dt>
									<dd>{expiry(item.expires_at)}</dd>
								</div>
							</dl>
							<Link className="button" href={`/otc/${item.id}`}>
								View listing
							</Link>
						</article>
					))}
				</div>
			) : (
				<div className="panel board-state">
					<h2>No listings found</h2>
					<p>
						{category || quote
							? "No active listings match these filters."
							: "New listings will appear here."}
					</p>
					{(category || quote) && (
						<button
							type="button"
							onClick={() => {
								setCategory("");
								setQuote("");
								setPage(1);
							}}
						>
							Clear filters
						</button>
					)}
				</div>
			)}
			{(page > 1 || query.data?.hasNext) && (
				<div className="actions pagination">
					<button
						type="button"
						disabled={page === 1}
						onClick={() => setPage(page - 1)}
					>
						Previous
					</button>
					<span>Page {page}</span>
					<button
						type="button"
						disabled={!query.data?.hasNext}
						onClick={() => setPage(page + 1)}
					>
						Next
					</button>
				</div>
			)}
		</section>
	);
}
