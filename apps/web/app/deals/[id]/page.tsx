'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { termsInput } from '@veil/core/contracts';
import { dealEncryptionKey, openTerms } from '@veil/core/vault';
import { api, useSession } from '../../providers';
import { expiry, short } from '../../otc/types';

interface Deal {
  id: string; listing_id: string; seller: string; buyer: string; expires_at: string;
  state: 'OFFERED' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED'; ciphertext: string | null;
}

export default function DealRoom() {
  const { id } = useParams<{id: string}>();
  const { token, seed, account } = useSession();
  const [terms, setTerms] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ['deal', id, account?.address], queryFn: () => api<Deal>(`/deals/${id}`, undefined, token),
    enabled: Boolean(token), retry: false, refetchInterval: 15_000,
  });
  const deal = query.data;
  async function reveal() {
    if (!seed || !deal?.ciphertext) return;
    try {
      const key = await dealEncryptionKey(seed, window.location.host);
      try {
        const value = termsInput.omit({ mint: true, minimumFill: true }).parse(JSON.parse(openTerms(deal.ciphertext, key.secretKey)));
        setTerms(`${value.size} tokens at ${value.price} ${value.quote} each`);
      } finally { key.secretKey.fill(0); }
    } catch { setNotice('Could not decrypt this offer'); }
  }
  async function accept() {
    setBusy(true);
    setNotice('');
    try { await api(`/deals/${id}/accept`, {method: 'POST'}, token); await query.refetch(); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not accept offer'); }
    finally { setBusy(false); }
  }
  return <section className="stack"><div className="section-head"><h1>Deal room</h1><p>Review the offer and track its status.</p></div>
    {!token ? <div className="panel">Sign in with a participating wallet.</div> : query.isError ?
      <div className="panel" role="alert">{query.error.message}</div> : !deal ? <div className="panel">Loading deal…</div> :
      <div className="grid two">
        <article className="panel stack"><div className="split"><h2>Offer</h2><span className="tag">{deal.state}</span></div>
          <dl><div><dt>Seller</dt><dd>{short(deal.seller)}</dd></div><div><dt>Buyer</dt><dd>{short(deal.buyer)}</dd></div>
            <div><dt>Expires</dt><dd>{expiry(deal.expires_at)}</dd></div></dl>
          <Link href={`/otc/${deal.listing_id}`}>View listing</Link>
          {seed && deal.ciphertext && <button type="button" onClick={reveal}>Decrypt offer</button>}
          {seed && deal.ciphertext && terms && <p>{terms}</p>}
          {seed && deal.ciphertext && terms && deal.state === 'OFFERED' && <button className="primary" type="button" disabled={busy} onClick={accept}>Accept offer</button>}
          {notice && <p role="alert">{notice}</p>}
        </article>
        <article className="panel stack"><h2>Settlement</h2><p>Funding and atomic settlement are unavailable. Acceptance is recorded as a negotiation status.</p>
          <div className="actions"><button type="button" disabled>Fund</button><button type="button" disabled>Seal</button></div>
        </article>
      </div>}
  </section>;
}
