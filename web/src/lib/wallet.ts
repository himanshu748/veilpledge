import type {
  Configuration,
  ConnectedAPI,
  InitialAPI,
  WalletConnectedAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  Binding,
  type FinalizedTransaction,
  Proof,
  SignatureEnabled,
  Transaction,
  type TransactionId,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { createProofProvider, type UnboundTransaction } from "@midnight-ntwrk/midnight-js-types";
import semver from "semver";

import type { VeilPledgeCircuitId, VeilPledgeProviders } from "./contract";
import {
  createVeilPledgePrivateStateProvider,
  type PersistentBrowserStorage,
} from "./private-state";

export const PREPROD_NETWORK_ID = "preprod" as const;
export const PREPROD_INDEXER_URI =
  "https://indexer.preprod.midnight.network/api/v4/graphql" as const;
export const PREPROD_INDEXER_WS_URI =
  "wss://indexer.preprod.midnight.network/api/v4/graphql/ws" as const;
export const COMPATIBLE_CONNECTOR_API_VERSION = "4.x" as const;

export class WalletConnectorNotFoundError extends Error {
  override readonly name = "WalletConnectorNotFoundError";
}

export class WalletNetworkMismatchError extends Error {
  override readonly name = "WalletNetworkMismatchError";

  constructor(readonly actualNetwork: string | undefined) {
    super(
      actualNetwork
        ? `Lace is connected to ${actualNetwork}; switch it to ${PREPROD_NETWORK_ID}.`
        : "The Lace connection is no longer active.",
    );
  }
}

export class WalletSessionChangedError extends Error {
  override readonly name = "WalletSessionChangedError";

  constructor() {
    super(
      "The active Lace account or connection changed. Reconnect before submitting a private transaction.",
    );
  }
}

const isCompatibleConnector = (value: unknown): value is InitialAPI => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InitialAPI>;
  return (
    typeof candidate.apiVersion === "string" &&
    semver.valid(candidate.apiVersion) !== null &&
    semver.satisfies(candidate.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION) &&
    typeof candidate.connect === "function"
  );
};

const findCompatibleConnector = (): InitialAPI | undefined => {
  const injected = globalThis.window?.midnight;
  if (!injected) return undefined;
  return Object.values(injected).find(isCompatibleConnector);
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

/** Wait briefly for an injected dapp connector and require API major version 4. */
export const discoverCompatibleConnector = async (
  timeoutMs = 2_000,
): Promise<InitialAPI> => {
  const deadline = Date.now() + timeoutMs;

  do {
    const connector = findCompatibleConnector();
    if (connector) return connector;
    await delay(100);
  } while (Date.now() < deadline);

  throw new WalletConnectorNotFoundError(
    `No Midnight wallet connector satisfying ${COMPATIBLE_CONNECTOR_API_VERSION} was found.`,
  );
};

export interface ConnectedWalletContext {
  readonly connector: InitialAPI;
  readonly connectedAPI: ConnectedAPI;
  readonly configuration: Configuration;
  readonly accountId: string;
  readonly address: string;
  readonly shieldedAddress: string;
  readonly shieldedCoinPublicKey: string;
  readonly shieldedEncryptionPublicKey: string;
}

/**
 * Re-checks the wallet immediately before every write. A network or account
 * switch invalidates the provider/private-state binding created at connect.
 */
export const revalidateConnectedWallet = async (
  wallet: ConnectedWalletContext,
): Promise<void> => {
  const configuration = await assertPreprodConnection(wallet.connectedAPI);
  const [shielded, unshielded] = await Promise.all([
    wallet.connectedAPI.getShieldedAddresses(),
    wallet.connectedAPI.getUnshieldedAddress(),
  ]);

  if (
    configuration.indexerUri !== wallet.configuration.indexerUri ||
    configuration.indexerWsUri !== wallet.configuration.indexerWsUri ||
    unshielded.unshieldedAddress !== wallet.accountId ||
    shielded.shieldedAddress !== wallet.shieldedAddress ||
    shielded.shieldedCoinPublicKey !== wallet.shieldedCoinPublicKey ||
    shielded.shieldedEncryptionPublicKey !== wallet.shieldedEncryptionPublicKey
  ) {
    throw new WalletSessionChangedError();
  }
};

const assertPreprodConnection = async (
  connectedAPI: ConnectedAPI,
): Promise<Configuration> => {
  const status = await connectedAPI.getConnectionStatus();
  if (status.status !== "connected" || status.networkId !== PREPROD_NETWORK_ID) {
    throw new WalletNetworkMismatchError(
      status.status === "connected" ? status.networkId : undefined,
    );
  }

  const configuration = await connectedAPI.getConfiguration();
  if (configuration.networkId !== PREPROD_NETWORK_ID) {
    throw new WalletNetworkMismatchError(configuration.networkId);
  }
  if (!configuration.indexerUri || !configuration.indexerWsUri) {
    throw new Error("Lace returned an incomplete Preprod indexer configuration.");
  }

  return configuration;
};

/** Connects explicitly to Preprod and validates both wallet status and config. */
export const connectPreprodWallet = async (
  connectorTimeoutMs = 2_000,
): Promise<ConnectedWalletContext> => {
  const connector = await discoverCompatibleConnector(connectorTimeoutMs);
  const connectedAPI = await connector.connect(PREPROD_NETWORK_ID);
  const configuration = await assertPreprodConnection(connectedAPI);

  const expectedMethods: Array<keyof WalletConnectedAPI> = [
    "getConnectionStatus",
    "getConfiguration",
    "getShieldedAddresses",
    "getUnshieldedAddress",
    "getProvingProvider",
    "balanceUnsealedTransaction",
    "submitTransaction",
  ];
  try {
    await connectedAPI.hintUsage(expectedMethods);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unsupportedByLace =
      connector.name === "Lace" &&
      connector.apiVersion === "4.0.1" &&
      /Method not implemented/i.test(message);

    if (!unsupportedByLace) throw error;
  }

  const [shielded, unshielded] = await Promise.all([
    connectedAPI.getShieldedAddresses(),
    connectedAPI.getUnshieldedAddress(),
  ]);

  return {
    connector,
    connectedAPI,
    configuration,
    accountId: unshielded.unshieldedAddress,
    address: unshielded.unshieldedAddress,
    shieldedAddress: shielded.shieldedAddress,
    shieldedCoinPublicKey: shielded.shieldedCoinPublicKey,
    shieldedEncryptionPublicKey: shielded.shieldedEncryptionPublicKey,
  };
};

export interface CreateBrowserProvidersOptions {
  readonly zkConfigBaseUrl?: string;
  readonly storage?: PersistentBrowserStorage;
}

/** Public Preprod provider used to render the board before wallet authorization. */
export const createPreprodPublicDataProvider = () => {
  setNetworkId(PREPROD_NETWORK_ID);
  return indexerPublicDataProvider(
    PREPROD_INDEXER_URI,
    PREPROD_INDEXER_WS_URI,
    globalThis.WebSocket as unknown as NonNullable<
      Parameters<typeof indexerPublicDataProvider>[2]
    >,
  );
};

const defaultZkConfigBaseUrl = (): string =>
  new URL(import.meta.env.BASE_URL, globalThis.window.location.origin).toString();

/** Builds the browser providers using Lace for proof generation and tx custody. */
export const createBrowserProviders = async (
  wallet: ConnectedWalletContext,
  options: CreateBrowserProvidersOptions = {},
): Promise<VeilPledgeProviders> => {
  // midnight-js address parsing is network-global, so set it only after the
  // connector and configuration have both been verified as Preprod.
  setNetworkId(PREPROD_NETWORK_ID);

  const zkConfigProvider = new FetchZkConfigProvider<VeilPledgeCircuitId>(
    options.zkConfigBaseUrl ?? defaultZkConfigBaseUrl(),
    globalThis.window.fetch.bind(globalThis.window),
  );
  const provingProvider = await wallet.connectedAPI.getProvingProvider(
    zkConfigProvider.asKeyMaterialProvider(),
  );
  const privateStateProvider = await createVeilPledgePrivateStateProvider(
    wallet.accountId,
    options.storage,
  );

  return {
    privateStateProvider,
    zkConfigProvider,
    proofProvider: createProofProvider(provingProvider),
    publicDataProvider: indexerPublicDataProvider(
      wallet.configuration.indexerUri,
      wallet.configuration.indexerWsUri,
      globalThis.WebSocket as unknown as NonNullable<
        Parameters<typeof indexerPublicDataProvider>[2]
      >,
    ),
    walletProvider: {
      getCoinPublicKey: () => wallet.shieldedCoinPublicKey,
      getEncryptionPublicKey: () => wallet.shieldedEncryptionPublicKey,
      balanceTx: async (
        tx: UnboundTransaction,
        _ttl?: Date,
      ): Promise<FinalizedTransaction> => {
        await revalidateConnectedWallet(wallet);
        const balanced = await wallet.connectedAPI.balanceUnsealedTransaction(
          toHex(tx.serialize()),
        );
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          "signature",
          "proof",
          "binding",
          fromHex(balanced.tx),
        );
      },
    },
    midnightProvider: {
      submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
        await revalidateConnectedWallet(wallet);
        await wallet.connectedAPI.submitTransaction(toHex(tx.serialize()));
        const txId = tx.identifiers()[0];
        if (!txId) throw new Error("The finalized transaction has no identifier.");
        return txId;
      },
    },
  };
};
