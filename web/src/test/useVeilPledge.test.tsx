import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../generated/deployment", () => ({
  PREPROD_DEPLOYMENT: {
    network: "preprod",
    contractAddress:
      "abababababababababababababababababababababababababababababababab",
    transactionHash:
      "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
    blockHeight: 1_600_000,
    deployedAt: "2026-07-11T00:00:00.000Z",
  },
}));

vi.mock("../lib", () => {
  class WalletConnectorNotFoundError extends Error {
    override readonly name = "WalletConnectorNotFoundError";
  }

  class WalletNetworkMismatchError extends Error {
    override readonly name = "WalletNetworkMismatchError";

    constructor(readonly actualNetwork: string | undefined) {
      super(
        actualNetwork
          ? `Lace is connected to ${actualNetwork}; switch it to preprod.`
          : "The Lace connection is no longer active.",
      );
    }
  }

  class WalletSessionChangedError extends Error {
    override readonly name = "WalletSessionChangedError";

    constructor() {
      super(
        "The active Lace account or connection changed. Reconnect before submitting a private transaction.",
      );
    }
  }

  return {
    connectVeilPledge: vi.fn(),
    queryPreprodPublicState: vi.fn(),
    WalletConnectorNotFoundError,
    WalletNetworkMismatchError,
    WalletSessionChangedError,
  };
});

import {
  connectVeilPledge,
  queryPreprodPublicState,
  WalletConnectorNotFoundError,
  WalletNetworkMismatchError,
  WalletSessionChangedError,
  type CompletePledgeResult,
  type CreatePledgeResult,
  type VeilPledgeClient,
  type VeilPledgePublicState,
  type VeilPledgeState,
} from "../lib";
import type { VeilPledgeViewModel } from "../types";
import { useVeilPledge } from "../controller/useVeilPledge";

const CONTRACT_ADDRESS =
  "abababababababababababababababababababababababababababababababab";
const WALLET_ADDRESS = "addr_test1qzveilpledgeowner";
const OWNER_COMMITMENT = "11".repeat(32);
const NEXT_COMMITMENT = "22".repeat(32);

const OPEN_PUBLIC_STATE: VeilPledgePublicState = {
  status: "open",
  goal: undefined,
  sequence: 0n,
  completionCount: 0n,
  ownerCommitment: "00".repeat(32),
};

const ACTIVE_PUBLIC_STATE: VeilPledgePublicState = {
  status: "active",
  goal: "Ship the VeilPledge beta",
  sequence: 1n,
  completionCount: 0n,
  ownerCommitment: OWNER_COMMITMENT,
};

const CONNECTED_OPEN_STATE: VeilPledgeState = {
  ...OPEN_PUBLIC_STATE,
  isOwner: false,
  localOwnership: undefined,
};

const CONNECTED_OWNER_STATE: VeilPledgeState = {
  ...ACTIVE_PUBLIC_STATE,
  isOwner: true,
  localOwnership: {
    sequence: "1",
    txId: "create-tx-id",
    blockHeight: 1_600_001,
  },
};

const OPEN_AFTER_COMPLETION_STATE: VeilPledgeState = {
  status: "open",
  goal: undefined,
  sequence: 2n,
  completionCount: 1n,
  ownerCommitment: NEXT_COMMITMENT,
  isOwner: false,
  localOwnership: undefined,
};

const CREATE_RESULT: CreatePledgeResult = {
  circuit: "createPledge",
  goal: ACTIVE_PUBLIC_STATE.goal!,
  txId: "create-tx-id",
  txHash: "aa".repeat(32),
  identifiers: ["create-tx-id"],
  blockHash: "bb".repeat(32),
  blockHeight: 1_600_001,
  blockTimestamp: 1_752_192_000,
  sequence: 0n,
  newSequence: 1n,
  previousCommitment: OPEN_PUBLIC_STATE.ownerCommitment,
};

const COMPLETE_RESULT: CompletePledgeResult = {
  circuit: "completePledge",
  completedGoal: ACTIVE_PUBLIC_STATE.goal!,
  txId: "complete-tx-id",
  txHash: "cc".repeat(32),
  identifiers: ["complete-tx-id"],
  blockHash: "dd".repeat(32),
  blockHeight: 1_600_002,
  blockTimestamp: 1_752_192_100,
  sequence: 1n,
  newSequence: 2n,
  previousCommitment: OWNER_COMMITMENT,
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function makeClient(initialState: VeilPledgeState) {
  const stateUpdates = new Subject<VeilPledgeState>();
  const queryState = vi.fn(async () => initialState);
  const createPledge = vi.fn<(goal: string) => Promise<CreatePledgeResult>>();
  const completePledge = vi.fn<() => Promise<CompletePledgeResult>>();
  const observeState = vi.fn(() => stateUpdates.asObservable());
  const client = {
    wallet: { address: WALLET_ADDRESS },
    queryState,
    createPledge,
    completePledge,
    observeState,
  } as unknown as VeilPledgeClient;

  return {
    client,
    stateUpdates,
    queryState,
    createPledge,
    completePledge,
    observeState,
  };
}

const mockedConnectVeilPledge = vi.mocked(connectVeilPledge);
const mockedQueryPublicState = vi.mocked(queryPreprodPublicState);

function expectPhase<TPhase extends VeilPledgeViewModel["phase"]>(
  viewModel: VeilPledgeViewModel,
  phase: TPhase,
): asserts viewModel is Extract<VeilPledgeViewModel, { phase: TPhase }> {
  expect(viewModel.phase).toBe(phase);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedQueryPublicState.mockResolvedValue(OPEN_PUBLIC_STATE);
});

afterEach(cleanup);

describe("useVeilPledge", () => {
  it("shows the public ledger as loading until its first state is ready", async () => {
    const publicState = deferred<VeilPledgePublicState>();
    mockedQueryPublicState.mockImplementation(() => publicState.promise);
    const { result } = renderHook(() => useVeilPledge());

    expect(result.current.viewModel.ledger).toMatchObject({
      boardStatus: "Loading",
      sequence: "—",
      completed: "—",
      ownerCommitment: "Not indexed",
    });

    await act(async () => {
      publicState.resolve(OPEN_PUBLIC_STATE);
      await publicState.promise;
    });
    await waitFor(() => {
      expect(result.current.viewModel.ledger.boardStatus).toBe("Open");
    });
  });

  it("marks a failed public read unavailable without blocking a wallet retry", async () => {
    mockedQueryPublicState.mockRejectedValue(
      new Error("The Preprod indexer is temporarily unavailable."),
    );
    const mockClient = makeClient(CONNECTED_OPEN_STATE);
    mockedConnectVeilPledge.mockResolvedValue(mockClient.client);
    const { result } = renderHook(() => useVeilPledge());

    await waitFor(() => {
      expect(result.current.viewModel.ledger.boardStatus).toBe("Unavailable");
    });
    expect(result.current.viewModel).toMatchObject({
      phase: "disconnected",
      wallet: { status: "disconnected" },
      ledger: {
        boardStatus: "Unavailable",
        sequence: "—",
        completed: "—",
        ownerCommitment: "Not indexed",
      },
    });

    act(() => result.current.actions.onConnect?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("connected-open");
    });
    expect(result.current.viewModel.ledger.boardStatus).toBe("Open");
    expect(mockedConnectVeilPledge).toHaveBeenCalledOnce();
  });

  it("renders the public open ledger without requesting wallet access", async () => {
    const { result } = renderHook(() => useVeilPledge());

    await waitFor(() => {
      expect(result.current.viewModel.ledger.boardStatus).toBe("Open");
    });

    const viewModel = result.current.viewModel;
    expectPhase(viewModel, "disconnected");
    expect(viewModel.wallet).toEqual({ status: "disconnected" });
    expect(viewModel.ledger).toMatchObject({
      boardStatus: "Open",
      sequence: "0",
      completed: "0",
      ownerCommitment: OPEN_PUBLIC_STATE.ownerCommitment,
    });
    expect(mockedQueryPublicState).toHaveBeenCalledWith(CONTRACT_ADDRESS);
    expect(mockedConnectVeilPledge).not.toHaveBeenCalled();
  });

  it("shows an active public pledge without inferring private ownership", async () => {
    mockedQueryPublicState.mockResolvedValue(ACTIVE_PUBLIC_STATE);
    const { result } = renderHook(() => useVeilPledge());

    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("public-active");
    });

    const viewModel = result.current.viewModel;
    expectPhase(viewModel, "public-active");
    expect(viewModel.wallet).toEqual({ status: "disconnected" });
    expect(viewModel.pledgeText).toBe(ACTIVE_PUBLIC_STATE.goal);
    expect(viewModel.isOwner).toBe(false);
    expect(viewModel.ownerMessage).toContain("Connect the Lace account");
    expect(viewModel.ledger).toMatchObject({
      boardStatus: "Active",
      ownerCommitment: OWNER_COMMITMENT,
      ownerCommitmentLabel: "11111111…111111",
    });
  });

  it("connects Lace and exposes the wallet-backed open state", async () => {
    const mockClient = makeClient(CONNECTED_OPEN_STATE);
    mockedConnectVeilPledge.mockResolvedValue(mockClient.client);
    const { result } = renderHook(() => useVeilPledge());

    await waitFor(() => {
      expect(result.current.viewModel.ledger.boardStatus).toBe("Open");
    });
    act(() => result.current.actions.onConnect?.());

    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("connected-open");
    });

    const viewModel = result.current.viewModel;
    expectPhase(viewModel, "connected-open");
    expect(viewModel.wallet).toEqual({
      status: "connected",
      address: WALLET_ADDRESS,
    });
    expect(mockedConnectVeilPledge).toHaveBeenCalledWith({
      contractAddress: CONTRACT_ADDRESS,
    });
    expect(mockClient.queryState).toHaveBeenCalledOnce();
    expect(mockClient.observeState).toHaveBeenCalledOnce();
  });

  it("maps a missing connector to a specific, retryable Lace error", async () => {
    mockedConnectVeilPledge.mockRejectedValue(
      new WalletConnectorNotFoundError("No compatible connector was found."),
    );
    const { result } = renderHook(() => useVeilPledge());

    act(() => result.current.actions.onConnect?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("error");
    });

    const viewModel = result.current.viewModel;
    expectPhase(viewModel, "error");
    expect(viewModel).toMatchObject({
      title: "Lace wallet not found",
      message: "Install or enable Lace, then return here to connect on Preprod.",
      noticeKind: "lace-missing",
      retryLabel: "Check again",
      wallet: { status: "disconnected" },
    });
  });

  it("maps a non-Preprod wallet to a specific network error", async () => {
    mockedConnectVeilPledge.mockRejectedValue(
      new WalletNetworkMismatchError("preview"),
    );
    const { result } = renderHook(() => useVeilPledge());

    act(() => result.current.actions.onConnect?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("error");
    });

    const viewModel = result.current.viewModel;
    expectPhase(viewModel, "error");
    expect(viewModel).toMatchObject({
      title: "Switch Lace to Preprod",
      message: "Lace is connected to preview; switch it to preprod.",
      noticeKind: "wrong-network",
      retryLabel: "Check network again",
      wallet: { status: "disconnected" },
    });
  });

  it("reports create-circuit progress and succeeds only after confirmed state", async () => {
    const circuit = deferred<CreatePledgeResult>();
    const confirmation = deferred<VeilPledgeState>();
    const mockClient = makeClient(CONNECTED_OPEN_STATE);
    mockClient.queryState
      .mockResolvedValueOnce(CONNECTED_OPEN_STATE)
      .mockImplementationOnce(() => confirmation.promise);
    mockClient.createPledge.mockImplementation(() => circuit.promise);
    mockedConnectVeilPledge.mockResolvedValue(mockClient.client);
    const { result } = renderHook(() => useVeilPledge());

    act(() => result.current.actions.onConnect?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("connected-open");
    });

    act(() => result.current.actions.onCreatePledge?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("busy");
      expect(
        result.current.viewModel.phase === "busy" &&
          result.current.viewModel.operation,
      ).toBe("creating");
    });
    expect(mockClient.createPledge).toHaveBeenCalledWith(
      "Ship the VeilPledge beta",
    );

    await act(async () => {
      circuit.resolve(CREATE_RESULT);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("busy");
      expect(
        result.current.viewModel.phase === "busy" &&
          result.current.viewModel.operation,
      ).toBe("submitting");
    });
    expect(result.current.viewModel.phase).not.toBe("success");

    await act(async () => {
      confirmation.resolve(CONNECTED_OWNER_STATE);
      await confirmation.promise;
    });
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("success");
    });

    const viewModel = result.current.viewModel;
    expectPhase(viewModel, "success");
    expect(viewModel.outcome).toBe("created");
    expect(viewModel.pledgeText).toBe(ACTIVE_PUBLIC_STATE.goal);
    expect(viewModel.ledger.boardStatus).toBe("Active");
    expect(viewModel.transaction).toEqual({
      label: "aaaaaaaa…aaaaaa",
      hash: "aa".repeat(32),
      href: "https://preprod.midnightexplorer.com/",
      blockHeight: "1,600,001",
      previousCommitment: "00000000…000000",
      newSequence: "1",
    });
  });

  it("invalidates a stale client when Lace changes account before a write", async () => {
    const mockClient = makeClient(CONNECTED_OPEN_STATE);
    mockClient.createPledge.mockRejectedValue(new WalletSessionChangedError());
    mockedConnectVeilPledge.mockResolvedValue(mockClient.client);
    const { result } = renderHook(() => useVeilPledge());

    act(() => result.current.actions.onConnect?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("connected-open");
    });

    act(() => result.current.actions.onCreatePledge?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("error");
    });

    expect(result.current.viewModel).toMatchObject({
      phase: "error",
      title: "Reconnect Lace",
      noticeKind: "disconnected",
      wallet: { status: "disconnected" },
    });
  });

  it("reports ownership-proof progress and completes the active pledge", async () => {
    mockedQueryPublicState.mockResolvedValue(ACTIVE_PUBLIC_STATE);
    const circuit = deferred<CompletePledgeResult>();
    const confirmation = deferred<VeilPledgeState>();
    const mockClient = makeClient(CONNECTED_OWNER_STATE);
    mockClient.queryState
      .mockResolvedValueOnce(CONNECTED_OWNER_STATE)
      .mockImplementationOnce(() => confirmation.promise);
    mockClient.completePledge.mockImplementation(() => circuit.promise);
    mockedConnectVeilPledge.mockResolvedValue(mockClient.client);
    const { result } = renderHook(() => useVeilPledge());

    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("public-active");
    });
    act(() => result.current.actions.onConnect?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("connected-active");
    });

    act(() => result.current.actions.onCompletePledge?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("busy");
      expect(
        result.current.viewModel.phase === "busy" &&
          result.current.viewModel.operation,
      ).toBe("proving");
    });
    expect(mockClient.completePledge).toHaveBeenCalledOnce();

    await act(async () => {
      circuit.resolve(COMPLETE_RESULT);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("busy");
      expect(
        result.current.viewModel.phase === "busy" &&
          result.current.viewModel.operation,
      ).toBe("submitting");
    });

    await act(async () => {
      confirmation.resolve(OPEN_AFTER_COMPLETION_STATE);
      await confirmation.promise;
    });
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("success");
    });

    const viewModel = result.current.viewModel;
    expectPhase(viewModel, "success");
    expect(viewModel.outcome).toBe("completed");
    expect(viewModel.pledgeText).toBe(ACTIVE_PUBLIC_STATE.goal);
    expect(viewModel.ledger).toMatchObject({
      boardStatus: "Completed",
      sequence: "2",
      completed: "1",
    });
    expect(viewModel.transaction).toEqual({
      label: "cccccccc…cccccc",
      hash: "cc".repeat(32),
      href: "https://preprod.midnightexplorer.com/",
      blockHeight: "1,600,002",
      previousCommitment: "11111111…111111",
      newSequence: "2",
    });
  });

  it("locally disconnects and strips wallet-only ownership from the public view", async () => {
    mockedQueryPublicState.mockResolvedValue(ACTIVE_PUBLIC_STATE);
    const mockClient = makeClient(CONNECTED_OWNER_STATE);
    mockedConnectVeilPledge.mockResolvedValue(mockClient.client);
    const { result } = renderHook(() => useVeilPledge());

    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("public-active");
    });
    act(() => result.current.actions.onConnect?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("connected-active");
    });
    const connectedView = result.current.viewModel;
    expectPhase(connectedView, "connected-active");
    expect(connectedView.isOwner).toBe(true);

    act(() => result.current.actions.onDisconnect?.());
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("public-active");
    });

    const publicView = result.current.viewModel;
    expectPhase(publicView, "public-active");
    expect(publicView.wallet).toEqual({ status: "disconnected" });
    expect(publicView.isOwner).toBe(false);
    expect(publicView.pledgeText).toBe(ACTIVE_PUBLIC_STATE.goal);

    act(() => {
      mockClient.stateUpdates.next({
        ...CONNECTED_OWNER_STATE,
        goal: "A stale private subscription must not update this pledge",
      });
    });
    expect(result.current.viewModel).toMatchObject({
      phase: "public-active",
      pledgeText: ACTIVE_PUBLIC_STATE.goal,
      isOwner: false,
    });
  });

  it("prevents duplicate connect and circuit actions while work is in flight", async () => {
    const connection = deferred<VeilPledgeClient>();
    const circuit = deferred<CreatePledgeResult>();
    const mockClient = makeClient(CONNECTED_OPEN_STATE);
    mockClient.queryState
      .mockResolvedValueOnce(CONNECTED_OPEN_STATE)
      .mockResolvedValueOnce(CONNECTED_OWNER_STATE);
    mockClient.createPledge.mockImplementation(() => circuit.promise);
    mockedConnectVeilPledge.mockImplementation(() => connection.promise);
    const { result } = renderHook(() => useVeilPledge());

    act(() => {
      result.current.actions.onConnect?.();
      result.current.actions.onConnect?.();
    });
    expect(mockedConnectVeilPledge).toHaveBeenCalledOnce();
    expect(result.current.viewModel.phase).toBe("connecting");

    await act(async () => {
      connection.resolve(mockClient.client);
      await connection.promise;
    });
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("connected-open");
    });

    act(() => {
      result.current.actions.onCreatePledge?.();
      result.current.actions.onCreatePledge?.();
    });
    await waitFor(() => {
      expect(mockClient.createPledge).toHaveBeenCalledOnce();
    });

    await act(async () => {
      circuit.resolve(CREATE_RESULT);
      await circuit.promise;
    });
    await waitFor(() => {
      expect(result.current.viewModel.phase).toBe("success");
    });
    expect(mockClient.createPledge).toHaveBeenCalledOnce();
  });

  it("does not reconnect when a pending local connection is cancelled", async () => {
    const connection = deferred<VeilPledgeClient>();
    const mockClient = makeClient(CONNECTED_OWNER_STATE);
    mockedConnectVeilPledge.mockImplementation(() => connection.promise);
    const { result } = renderHook(() => useVeilPledge());

    act(() => result.current.actions.onConnect?.());
    expect(result.current.viewModel.phase).toBe("connecting");

    act(() => result.current.actions.onDisconnect?.());
    expect(result.current.viewModel.wallet.status).toBe("disconnected");

    await act(async () => {
      connection.resolve(mockClient.client);
      await connection.promise;
    });
    await waitFor(() => {
      expect(result.current.viewModel.wallet.status).toBe("disconnected");
    });
    expect(result.current.viewModel.phase).not.toBe("connected-active");
    expect(mockClient.observeState).not.toHaveBeenCalled();
  });
});
