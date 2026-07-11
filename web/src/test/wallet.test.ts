import type {
  Configuration,
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import type {
  FinalizedTransaction,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type { UnboundTransaction } from "@midnight-ntwrk/midnight-js-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@midnight-ntwrk/midnight-js-fetch-zk-config-provider", () => ({
  FetchZkConfigProvider: class {
    asKeyMaterialProvider() {
      return {};
    }
  },
}));

vi.mock("@midnight-ntwrk/midnight-js-indexer-public-data-provider", () => ({
  indexerPublicDataProvider: vi.fn(() => ({})),
}));

vi.mock("@midnight-ntwrk/midnight-js-network-id", () => ({
  setNetworkId: vi.fn(),
}));

vi.mock("@midnight-ntwrk/midnight-js-protocol/compact-runtime", () => ({
  fromHex: vi.fn(),
  toHex: vi.fn(),
}));

vi.mock("@midnight-ntwrk/midnight-js-protocol/ledger", () => ({
  Transaction: { deserialize: vi.fn() },
}));

vi.mock("@midnight-ntwrk/midnight-js-types", () => ({
  createProofProvider: vi.fn(() => ({})),
}));

vi.mock("../lib/private-state", () => ({
  createVeilPledgePrivateStateProvider: vi.fn(async () => ({})),
}));

import {
  connectPreprodWallet,
  createBrowserProviders,
  WalletNetworkMismatchError,
  WalletSessionChangedError,
  type ConnectedWalletContext,
} from "../lib/wallet";

const CONFIGURATION: Configuration = {
  networkId: "preprod",
  indexerUri: "https://indexer.preprod.midnight.network/api/v4/graphql",
  indexerWsUri: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  substrateNodeUri: "https://rpc.preprod.midnight.network",
};

const ACCOUNT_ID = "mn_addr_preprod1owner";
const SHIELDED_ADDRESS = "mn_shield-addr_preprod1owner";
const COIN_PUBLIC_KEY = "mn_shield-cpk_preprod1owner";
const ENCRYPTION_PUBLIC_KEY = "mn_shield-epk_preprod1owner";

function makeWallet() {
  const getConnectionStatus = vi.fn(async () => ({
    status: "connected" as const,
    networkId: "preprod",
  }));
  const getConfiguration = vi.fn(async () => CONFIGURATION);
  const getUnshieldedAddress = vi.fn(async () => ({
    unshieldedAddress: ACCOUNT_ID,
  }));
  const getShieldedAddresses = vi.fn(async () => ({
    shieldedAddress: SHIELDED_ADDRESS,
    shieldedCoinPublicKey: COIN_PUBLIC_KEY,
    shieldedEncryptionPublicKey: ENCRYPTION_PUBLIC_KEY,
  }));
  const balanceUnsealedTransaction = vi.fn(async () => ({ tx: "00" }));
  const submitTransaction = vi.fn(async () => undefined);

  const connectedAPI = {
    getConnectionStatus,
    getConfiguration,
    getUnshieldedAddress,
    getShieldedAddresses,
    getProvingProvider: vi.fn(async () => ({})),
    balanceUnsealedTransaction,
    submitTransaction,
  } as unknown as ConnectedAPI;

  const wallet: ConnectedWalletContext = {
    connector: {} as InitialAPI,
    connectedAPI,
    configuration: CONFIGURATION,
    accountId: ACCOUNT_ID,
    address: ACCOUNT_ID,
    shieldedAddress: SHIELDED_ADDRESS,
    shieldedCoinPublicKey: COIN_PUBLIC_KEY,
    shieldedEncryptionPublicKey: ENCRYPTION_PUBLIC_KEY,
  };

  return {
    wallet,
    getConnectionStatus,
    getUnshieldedAddress,
    balanceUnsealedTransaction,
    submitTransaction,
  };
}

describe("delegated wallet transaction boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revalidates immediately before balancing and blocks a switched account", async () => {
    const mocks = makeWallet();
    const providers = await createBrowserProviders(mocks.wallet);
    mocks.getUnshieldedAddress.mockResolvedValue({
      unshieldedAddress: "mn_addr_preprod1changed",
    });

    await expect(
      providers.walletProvider.balanceTx({} as UnboundTransaction),
    ).rejects.toBeInstanceOf(WalletSessionChangedError);

    expect(mocks.getConnectionStatus).toHaveBeenCalledOnce();
    expect(mocks.balanceUnsealedTransaction).not.toHaveBeenCalled();
  });

  it("revalidates immediately before submission and blocks a switched network", async () => {
    const mocks = makeWallet();
    const providers = await createBrowserProviders(mocks.wallet);
    mocks.getConnectionStatus.mockResolvedValue({
      status: "connected",
      networkId: "preview",
    });

    await expect(
      providers.midnightProvider.submitTx({} as FinalizedTransaction),
    ).rejects.toBeInstanceOf(WalletNetworkMismatchError);

    expect(mocks.getConnectionStatus).toHaveBeenCalledOnce();
    expect(mocks.submitTransaction).not.toHaveBeenCalled();
  });
});

describe("Lace connector compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function installConnector(hintUsage: ConnectedAPI["hintUsage"]) {
    const connectedAPI = {
      getConnectionStatus: vi.fn(async () => ({
        status: "connected" as const,
        networkId: "preprod",
      })),
      getConfiguration: vi.fn(async () => CONFIGURATION),
      hintUsage,
      getShieldedAddresses: vi.fn(async () => ({
        shieldedAddress: SHIELDED_ADDRESS,
        shieldedCoinPublicKey: COIN_PUBLIC_KEY,
        shieldedEncryptionPublicKey: ENCRYPTION_PUBLIC_KEY,
      })),
      getUnshieldedAddress: vi.fn(async () => ({
        unshieldedAddress: ACCOUNT_ID,
      })),
    } as unknown as ConnectedAPI;
    const connector = {
      rdns: "io.lace.wallet",
      name: "Lace",
      icon: "data:image/png;base64,",
      apiVersion: "4.0.1",
      connect: vi.fn(async () => connectedAPI),
    } satisfies InitialAPI;

    (window as unknown as { midnight: Record<string, InitialAPI> }).midnight = {
      lace: connector,
    };

    return { connector, connectedAPI };
  }

  it("continues when Lace 4.0.1 reports hintUsage as unimplemented", async () => {
    const hintUsage = vi.fn(async () => {
      throw new Error("Method not implemented.");
    });
    const { connector } = installConnector(hintUsage);

    const wallet = await connectPreprodWallet();

    expect(connector.connect).toHaveBeenCalledWith("preprod");
    expect(hintUsage).toHaveBeenCalledOnce();
    expect(wallet.accountId).toBe(ACCOUNT_ID);
  });

  it("preserves unexpected hintUsage failures", async () => {
    const hintUsage = vi.fn(async () => {
      throw new Error("RPC channel closed");
    });
    installConnector(hintUsage);

    await expect(connectPreprodWallet()).rejects.toThrow("RPC channel closed");
  });
});
