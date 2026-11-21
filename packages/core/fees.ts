import { PLATFORM_FEE_BPS } from './config';

export function quoteFee(amount: bigint, bps = PLATFORM_FEE_BPS): bigint {
  if (amount <= 0n || bps < 0n || bps > 10_000n) throw new RangeError('Invalid quote or fee rate');
  return (amount * bps + 9_999n) / 10_000n;
}

export function parseUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new RangeError('Invalid decimals');
  if (!/^\d+(\.\d+)?$/.test(value)) throw new RangeError('Enter a decimal amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new RangeError('Amount exceeds token precision');
  const amount = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (amount < 1n || amount > 2n ** 64n - 1n) throw new RangeError('Amount is outside the token range');
  return amount;
}
