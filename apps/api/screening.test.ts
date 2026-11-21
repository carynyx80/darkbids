import { expect, test, vi } from 'vitest';
import { OfacProvider, readSolanaAddresses } from './screening';

const blocked = 'FuCC7GoYwt5TsNTjWL23Xx9UKCvC18chjMEFPL3vJDCC';
const feed = `<sdnList xmlns="urn:sdn"><sdnEntry><idList><id><uid>1</uid><idType>Digital Currency Address - SOL</idType><idNumber>${blocked}</idNumber></id></idList></sdnEntry></sdnList>`;

test('loads exact Solana identifiers and shares a concurrent refresh', async () => {
  const fetcher = vi.fn(async () => new Response(feed));
  vi.stubGlobal('fetch', fetcher);
  try {
    const provider = new OfacProvider();
    expect(await Promise.all([provider.blocked(blocked), provider.blocked('11111111111111111111111111111111')])).toEqual([true, false]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(blocked);
  } finally { vi.unstubAllGlobals(); }
});

test('rejects incomplete or invalid screening feeds', () => {
  expect(() => readSolanaAddresses('<html></html>')).toThrow();
  expect(() => readSolanaAddresses('<sdnList></sdnList>')).toThrow();
  expect(() => readSolanaAddresses(feed.replace(blocked, 'invalid'))).toThrow();
});
