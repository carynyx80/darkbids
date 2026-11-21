export interface ScreeningProvider {
  blocked(wallet: string): Promise<boolean>;
}

export function readSolanaAddresses(xml: string): Set<string> {
  if (!/<(?:\w+:)?sdnList\b/.test(xml) || !/<\/(?:\w+:)?sdnList>\s*$/.test(xml)) {
    throw new Error('Invalid screening feed');
  }
  const entries = [...xml.matchAll(/<id>\s*[\s\S]*?<\/id>/g)];
  const addresses = new Set<string>();
  for (const [entry] of entries) {
    if (!/<idType>Digital Currency Address\s*-\s*SOL<\/idType>/i.test(entry)) continue;
    const match = entry.match(/<idNumber>\s*([1-9A-HJ-NP-Za-km-z]{32,44})\s*<\/idNumber>/);
    if (!match) throw new Error('Invalid Solana identifier in screening feed');
    addresses.add(match[1]);
  }
  if (entries.length === 0 || addresses.size === 0) throw new Error('Incomplete screening feed');
  return addresses;
}

export class OfacProvider implements ScreeningProvider {
  private snapshot?: { addresses: Set<string>; expiresAt: number };
  private pending?: Promise<void>;

  async blocked(wallet: string) {
    if (!this.snapshot || this.snapshot.expiresAt <= Date.now()) {
      this.pending ??= this.refresh().finally(() => { this.pending = undefined; });
      await this.pending;
    }
    if (!this.snapshot) throw new Error('Screening unavailable');
    return this.snapshot.addresses.has(wallet);
  }

  private async refresh() {
    const response = await fetch('https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML', {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error('Screening unavailable');
    const addresses = readSolanaAddresses(await response.text());
    this.snapshot = { addresses, expiresAt: Date.now() + 15 * 60_000 };
  }
}
