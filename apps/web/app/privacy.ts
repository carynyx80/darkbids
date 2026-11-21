import {
  buildDepositTransaction, createSprClient, fetchAssetMetadata, getPrivateTokenBalances,
  getPrivateTransactions, LocalKeys, ShieldedKeypair, SigningKey, SOL_MINT, syncWallet, Wallet,
} from '@heliuslabs/spr';
import { SignedTeePolicy } from '@heliuslabs/spr/client';
import { address, getBase64EncodedWireTransaction, getTransactionDecoder, getTransactionEncoder } from '@solana/kit';
import { parseUnits } from '@veil/core/fees';
import { encode } from '@veil/core/vault';
import type { Account, StandardWallet } from './wallet';

export const network = process.env.NEXT_PUBLIC_NETWORK ?? 'devnet';

const proofDisabled = async (): Promise<never> => { throw new Error('Browser-only proving is unavailable'); };

const readWithBackoff: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(input, init);
    if (response.status !== 429 || attempt === 2) return response;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 700 * 2 ** attempt));
  }
};

export async function openPrivacy(seed: Uint8Array) {
  if (network !== 'devnet' && network !== 'localnet') throw new Error('Production vault disabled');
  const solanaRpcUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL || undefined;
  if (network === 'devnet' && !solanaRpcUrl) throw new Error('Devnet RPC is not configured');
  if (network === 'localnet' && solanaRpcUrl) throw new Error('Localnet uses the default loopback ports');
  const client = await createSprClient({
    solanaRpcUrl,
    proverTee: network === 'devnet' ? SignedTeePolicy.forNetwork('devnet') : undefined,
    fetch: readWithBackoff,
  });
  const seedCopy = new Uint8Array(seed);
  const key = ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(seedCopy as Parameters<typeof SigningKey.fromEd25519Bytes>[0]));
  const identity = key.shieldedAddress();
  const keys = LocalKeys.fromKeypair(key, { prove: proofDisabled, proveMerge: proofDisabled });
  const wallet = new Wallet({ identity });
  return {
    shieldedAddress: encode(identity.toBytes()),
    destroy() { keys.destroy(); key.destroy(); seedCopy.fill(0); },
    async read() {
      await syncWallet({ client, wallet, keys });
      const balances = await Promise.all(getPrivateTokenBalances(wallet).map(async balance => ({
        ...balance, decimals: (await fetchAssetMetadata(client, balance.mint)).decimals,
      })));
      return { balances, history: getPrivateTransactions(wallet) };
    },
    async deposit(provider: StandardWallet, account: Account, mint: string, value: string, progress: (label: string) => void) {
      if (process.env.NEXT_PUBLIC_ENABLE_TEST_DEPOSITS !== 'true') throw new Error('Test deposits are disabled');
      const signer = provider.features['solana:signTransaction'];
      const chain = `solana:${network}`;
      if (!signer?.supportedTransactionVersions.includes(1) || !account.chains.includes(chain)) {
        throw new Error(`Connect a Wallet Standard account that supports version 1 transactions on ${network}`);
      }
      const asset = mint ? address(mint) : SOL_MINT;
      const decimals = (await fetchAssetMetadata(client, asset)).decimals;
      const feePayer = address(account.address);
      const tokenProgram = asset === SOL_MINT ? undefined : (await client.getAccount(asset))?.owner;
      const transaction = await buildDepositTransaction({
        client, feePayer, asset, recipient: identity, amount: parseUnits(value, decimals),
        splTokenProgram: tokenProgram,
      });
      progress('Approve the public deposit in your wallet');
      const wire = getTransactionEncoder().encode(transaction);
      const [signed] = await signer.signTransaction({ account, chain, transaction: new Uint8Array(wire) });
      if (!signed) throw new Error('Wallet did not sign the deposit');
      const decoded = getTransactionDecoder().decode(signed.signedTransaction);
      if (decoded.messageBytes.length !== transaction.messageBytes.length ||
          !decoded.messageBytes.every((byte, index) => byte === transaction.messageBytes[index])) {
        throw new Error('Wallet modified the deposit transaction');
      }
      progress('Submitting to Solana');
      const signature = await client.solanaRpc.sendTransaction(getBase64EncodedWireTransaction(decoded), { encoding: 'base64' }).send();
      progress('Waiting for confirmation');
      await client.confirmTransaction(signature);
      return signature;
    },
  };
}
