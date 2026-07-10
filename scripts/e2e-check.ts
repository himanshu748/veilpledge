/**
 * End-to-end smoke check for veilpledge.
 *
 * Reconnects to the deployed contract, reads its ledger state, and exits 0
 * on success. Used by `npm run test:e2e` and by the project's CI workflows.
 */
import { WebSocket } from 'ws';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { resolveNetwork, getOrCreateSeed, getDeployment } from '../src/network';
import { createWallet, persistWalletState } from '../src/wallet';
import { loadVeilPledgeContract, zkConfigPath } from '../src/compiled-contract';
import { PRIVATE_STATE_ID, PRIVATE_STATE_STORE } from '../src/private-state';

// @ts-expect-error wallet sync requires WebSocket
globalThis.WebSocket = WebSocket;

// ─── Network configuration ─────────────────────────────────────────────────────

const { network, config: networkConfig } = resolveNetwork();
const SEED = getOrCreateSeed(network);

function fail(msg: string): never {
  console.error(`❌ e2e-check failed: ${msg}`);
  process.exit(1);
}

function isHexAddress(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length >= 32;
}

async function main() {
  // 1. Deployment sanity
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deploy on file for network ${network}.`);
    process.exit(1);
  }
  if (!isHexAddress(deployment.address)) {
    fail(`Deployment address missing or invalid: ${JSON.stringify(deployment, null, 2)}`);
  }

  // 2. Build wallet and providers
  const { contractModule: VeilPledge, compiledContract } = await loadVeilPledgeContract();

  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  const state = await walletCtx.wallet.waitForSyncedState();
  // Persist the sync state — saves time on the next e2e-check invocation in CI
  // when run against the same persistent wallet directory.
  await persistWalletState(network, walletCtx);

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const walletProvider = {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx() {
      throw new Error('e2e-check is read-only and should not balance transactions');
    },
    submitTx() {
      throw new Error('e2e-check is read-only and should not submit transactions');
    },
  } as any;

  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: PRIVATE_STATE_STORE,
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      // SDK requires ≥16 chars. e2e-check is read-only so we don't expose
      // the env-var override here — match the deploy script's local-devnet default.
      privateStoragePasswordProvider: () => 'Local-Devnet-Development-Placeholder-1',
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };

  // 3. Reconnect to the deployed contract — proves callTx interface is wired
  try {
    await findDeployedContract(providers, {
      contractAddress: deployment.address,
      compiledContract: compiledContract as any,
      privateStateId: PRIVATE_STATE_ID,
    });
  } catch (err: any) {
    await walletCtx.wallet.stop();
    fail(`findDeployedContract threw: ${err?.message ?? err}`);
  }

  // 4. Read the on-chain contract state via the public data provider — proves
  // the contract is indexed and queryable on the chain itself, not just that
  // we know how to construct the local handle.
  const onChainState = await providers.publicDataProvider.queryContractState(deployment.address);
  if (!onChainState) {
    await walletCtx.wallet.stop();
    fail(`queryContractState returned null for ${deployment.address}`);
  }

  const ledgerState = VeilPledge.ledger(onChainState.data);
  if (ledgerState.state !== VeilPledge.PledgeState.OPEN) {
    fail(`Expected a newly deployed OPEN pledge board; received state ${ledgerState.state}`);
  }
  if (ledgerState.goal.is_some) {
    fail('Expected a newly deployed contract to have no active pledge');
  }
  if (ledgerState.sequence !== 1n || ledgerState.completionCount !== 0n) {
    fail(
      `Unexpected counters: sequence=${ledgerState.sequence}, completionCount=${ledgerState.completionCount}`,
    );
  }

  console.log(`✅ e2e-check passed`);
  console.log(`   contractAddress: ${deployment.address}`);
  console.log(`   network:         ${network}`);
  console.log(`   pledgeState:     OPEN`);

  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
