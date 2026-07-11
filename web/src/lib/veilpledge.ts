import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import {
  convertFieldToBytes,
  toHex,
  type ContractAddress,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import type { FinalizedTxData } from "@midnight-ntwrk/midnight-js-types";
import { map, type Observable } from "rxjs";

import {
  compiledVeilPledgeContract,
  VEILPLEDGE_PRIVATE_STATE_ID,
  VeilPledge,
  type DeployedVeilPledgeContract,
  type VeilPledgePrivateState,
  type VeilPledgeProviders,
} from "./contract";
import {
  createVeilPledgePrivateState,
  LocalOwnershipStore,
  withPrivateStateInitializationLock,
  type LocalOwnershipRecord,
  type PersistentBrowserStorage,
} from "./private-state";
import {
  connectPreprodWallet,
  createBrowserProviders,
  createPreprodPublicDataProvider,
  PREPROD_NETWORK_ID,
  revalidateConnectedWallet,
  type ConnectedWalletContext,
} from "./wallet";

export type PledgeStatus = "open" | "active";

export interface VeilPledgePublicState {
  readonly status: PledgeStatus;
  readonly goal: string | undefined;
  readonly sequence: bigint;
  readonly completionCount: bigint;
  readonly ownerCommitment: string;
}

export interface VeilPledgeState extends VeilPledgePublicState {
  readonly isOwner: boolean;
  readonly localOwnership: LocalOwnershipRecord | undefined;
}

export type VeilPledgeCircuit = "createPledge" | "completePledge";

export interface VeilPledgeTransactionData {
  readonly circuit: VeilPledgeCircuit;
  readonly txId: string;
  readonly txHash: string;
  readonly identifiers: readonly string[];
  readonly blockHash: string;
  readonly blockHeight: number;
  readonly blockTimestamp: number;
  readonly sequence: bigint;
  readonly newSequence: bigint;
  readonly previousCommitment: string;
}

export interface CreatePledgeResult extends VeilPledgeTransactionData {
  readonly circuit: "createPledge";
  readonly goal: string;
}

export interface CompletePledgeResult extends VeilPledgeTransactionData {
  readonly circuit: "completePledge";
  readonly completedGoal: string;
}

export const decodePublicState = (contractState: {
  readonly data: Parameters<typeof VeilPledge.ledger>[0];
}): VeilPledgePublicState => {
  const ledger = VeilPledge.ledger(contractState.data);
  const active = ledger.state === VeilPledge.PledgeState.ACTIVE;

  return {
    status: active ? "active" : "open",
    goal: active && ledger.goal.is_some ? ledger.goal.value : undefined,
    sequence: ledger.sequence,
    completionCount: ledger.completionCount,
    ownerCommitment: toHex(ledger.ownerCommitment),
  };
};

const assertContractAddress = (contractAddress: string): ContractAddress => {
  if (!/^[0-9a-f]{64}$/iu.test(contractAddress)) {
    throw new TypeError("A 32-byte hexadecimal VeilPledge contract address is required.");
  }
  return contractAddress.toLowerCase();
};

/** Reads the public pledge board without requesting Lace authorization. */
export const queryPreprodPublicState = async (
  contractAddress: string,
): Promise<VeilPledgePublicState> => {
  const address = assertContractAddress(contractAddress);
  const state = await createPreprodPublicDataProvider().queryContractState(address);
  if (!state) throw new Error("The VeilPledge contract state is not indexed yet.");
  return decodePublicState(state);
};

const mapTransactionData = (
  circuit: VeilPledgeCircuit,
  tx: FinalizedTxData,
  state: VeilPledgePublicState,
): VeilPledgeTransactionData => ({
  circuit,
  txId: tx.txId,
  txHash: tx.txHash,
  identifiers: tx.identifiers,
  blockHash: tx.blockHash,
  blockHeight: tx.blockHeight,
  blockTimestamp: tx.blockTimestamp,
  sequence: state.sequence,
  newSequence: circuit === "completePledge" ? state.sequence + 1n : state.sequence,
  previousCommitment: state.ownerCommitment,
});

const commitmentMatches = (
  privateState: VeilPledgePrivateState,
  publicState: VeilPledgePublicState,
): boolean => {
  if (publicState.status !== "active") return false;
  const sequenceBytes = convertFieldToBytes(
    32,
    publicState.sequence,
    "web/src/lib/veilpledge.ts",
  );
  const derived = VeilPledge.pureCircuits.deriveOwner(privateState.secretKey, sequenceBytes);
  return toHex(derived) === publicState.ownerCommitment;
};

export interface ConnectVeilPledgeOptions {
  readonly contractAddress: string;
  readonly connectorTimeoutMs?: number;
  readonly zkConfigBaseUrl?: string;
  readonly storage?: PersistentBrowserStorage;
}

/** A connected, deployed VeilPledge contract backed by the current Lace account. */
export class VeilPledgeClient {
  readonly #privateState: VeilPledgePrivateState;
  readonly #ownership: LocalOwnershipStore;

  private constructor(
    readonly wallet: ConnectedWalletContext,
    readonly providers: VeilPledgeProviders,
    readonly deployedContract: DeployedVeilPledgeContract,
    readonly contractAddress: ContractAddress,
    privateState: VeilPledgePrivateState,
    ownership: LocalOwnershipStore,
  ) {
    this.#privateState = privateState;
    this.#ownership = ownership;
  }

  readonly network = PREPROD_NETWORK_ID;

  static async connect(options: ConnectVeilPledgeOptions): Promise<VeilPledgeClient> {
    const contractAddress = assertContractAddress(options.contractAddress);
    const wallet = await connectPreprodWallet(options.connectorTimeoutMs);
    const providers = await createBrowserProviders(wallet, {
      zkConfigBaseUrl: options.zkConfigBaseUrl,
      storage: options.storage,
    });

    const { deployedContract, privateState } = await withPrivateStateInitializationLock(
      wallet.accountId,
      contractAddress,
      async () => {
        providers.privateStateProvider.setContractAddress(contractAddress);
        const existingPrivateState = await providers.privateStateProvider.get(
          VEILPLEDGE_PRIVATE_STATE_ID,
        );

        // findDeployedContract stores initialPrivateState unconditionally when
        // it is supplied. Branching here prevents reconnect from replacing a
        // secret that owns an existing pledge.
        const resolvedPrivateState = existingPrivateState ?? createVeilPledgePrivateState();
        const resolvedContract = existingPrivateState
          ? await findDeployedContract(providers, {
              compiledContract: compiledVeilPledgeContract,
              contractAddress,
              privateStateId: VEILPLEDGE_PRIVATE_STATE_ID,
            })
          : await findDeployedContract(providers, {
              compiledContract: compiledVeilPledgeContract,
              contractAddress,
              privateStateId: VEILPLEDGE_PRIVATE_STATE_ID,
              initialPrivateState: resolvedPrivateState,
            });

        return {
          deployedContract: resolvedContract,
          privateState: resolvedPrivateState,
        };
      },
    );

    const ownership = await LocalOwnershipStore.create(
      wallet.accountId,
      contractAddress,
      options.storage,
    );

    return new VeilPledgeClient(
      wallet,
      providers,
      deployedContract,
      contractAddress,
      privateState,
      ownership,
    );
  }

  async queryPublicState(): Promise<VeilPledgePublicState> {
    const state = await this.providers.publicDataProvider.queryContractState(this.contractAddress);
    if (!state) throw new Error("The VeilPledge contract state is not indexed yet.");
    return decodePublicState(state);
  }

  observePublicState(): Observable<VeilPledgePublicState> {
    return this.providers.publicDataProvider
      .contractStateObservable(this.contractAddress, { type: "latest" })
      .pipe(map(decodePublicState));
  }

  async queryState(): Promise<VeilPledgeState> {
    return this.withLocalState(await this.queryPublicState());
  }

  observeState(): Observable<VeilPledgeState> {
    return this.observePublicState().pipe(map((state) => this.withLocalState(state)));
  }

  async createPledge(goal: string): Promise<CreatePledgeResult> {
    const normalizedGoal = goal.trim();
    if (!normalizedGoal) throw new TypeError("A pledge cannot be empty.");

    await revalidateConnectedWallet(this.wallet);
    const before = await this.queryPublicState();
    if (before.status !== "open") throw new Error("A pledge is already active.");

    const tx = await this.deployedContract.callTx.createPledge(normalizedGoal);
    const mapped = mapTransactionData("createPledge", tx.public, before);
    this.#ownership.remember({
      sequence: before.sequence.toString(),
      txId: mapped.txId,
      blockHeight: mapped.blockHeight,
    });

    return { ...mapped, circuit: "createPledge", goal: normalizedGoal };
  }

  async completePledge(): Promise<CompletePledgeResult> {
    await revalidateConnectedWallet(this.wallet);
    const before = await this.queryPublicState();
    if (before.status !== "active" || !before.goal) {
      throw new Error("There is no active pledge to complete.");
    }
    if (!commitmentMatches(this.#privateState, before)) {
      throw new Error("This Lace account does not own the active pledge.");
    }

    const tx = await this.deployedContract.callTx.completePledge();
    const mapped = mapTransactionData("completePledge", tx.public, before);
    return {
      ...mapped,
      circuit: "completePledge",
      completedGoal: before.goal,
    };
  }

  private withLocalState(publicState: VeilPledgePublicState): VeilPledgeState {
    return {
      ...publicState,
      isOwner: commitmentMatches(this.#privateState, publicState),
      localOwnership: this.#ownership.get(publicState.sequence),
    };
  }
}

export const connectVeilPledge = (
  options: ConnectVeilPledgeOptions,
): Promise<VeilPledgeClient> => VeilPledgeClient.connect(options);
