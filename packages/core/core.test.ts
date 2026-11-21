import { expect, test } from 'vitest';
import { parseUnits, quoteFee } from './fees';
import { dealEncryptionKey, deriveSeed, openTerms, sealTerms } from './vault';

test('fee rounds up at the smallest unit without floating point loss', () => {
  expect(quoteFee(200n)).toBe(1n);
  expect(quoteFee(201n)).toBe(2n);
  expect(quoteFee(1n)).toBe(1n);
  expect(quoteFee(10_000n, 30n)).toBe(30n);
  expect(quoteFee(1n, 0n)).toBe(0n);
  expect(() => quoteFee(0n)).toThrow();
  expect(() => quoteFee(1n, 10_001n)).toThrow();
  expect(parseUnits('123.000001', 6)).toBe(123000001n);
  expect(() => parseUnits('0.000001', 5)).toThrow();
  expect(() => parseUnits('18446744073709551616', 0)).toThrow();
});

test('vault derivation is deterministic and domain and purpose bound', async () => {
  const signature = new Uint8Array(64).fill(7);
  const seed = await deriveSeed(signature, 'test.example');
  expect(seed).toEqual(await deriveSeed(signature, 'test.example'));
  expect(seed).not.toEqual(await deriveSeed(signature, 'other.example'));
  expect(seed).not.toEqual(await deriveSeed(signature, 'test.example', 'deal:1'));
});

test('only the intended recipient can authenticate encrypted terms', async () => {
  const recipient = await dealEncryptionKey(new Uint8Array(32).fill(1), 'test.example');
  const other = await dealEncryptionKey(new Uint8Array(32).fill(2), 'test.example');
  const value = sealTerms('terms', recipient.publicKey);
  expect(openTerms(value, recipient.secretKey)).toBe('terms');
  expect(() => openTerms(value, other.secretKey)).toThrow();
});
