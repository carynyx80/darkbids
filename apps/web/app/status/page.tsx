'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '../providers';

export default function Status() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{network: string; database: string; settlement: string}>('/health'), retry: false, refetchInterval: 30_000 });
  return <section className="stack"><div className="section-head"><h1>Service status</h1></div><article className="panel">
    {health.isPending ? <p>Checking the desk API…</p> : health.isError ? <p role="alert">Desk API unavailable.</p> :
      <dl><div><dt>Network</dt><dd>{health.data.network}</dd></div><div><dt>Database</dt><dd>{health.data.database}</dd></div>
      <div><dt>Settlement</dt><dd>{health.data.settlement}</dd></div></dl>}
    <p>Helius connectivity is checked when the vault syncs.</p>
  </article></section>;
}
