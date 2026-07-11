import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { WalletNotice } from "../components/WalletNotice";
import type {
  BusyViewModel,
  ConnectedActiveViewModel,
  ConnectedOpenViewModel,
  ConnectingViewModel,
  DisconnectedViewModel,
  ErrorViewModel,
  LedgerSnapshot,
  SuccessViewModel,
  VeilPledgeActions,
  VeilPledgeViewModel,
} from "../types";

afterEach(cleanup);

const CONTRACT = {
  label: "03a38b…5a39",
  value: "03a38b13de46c09f93621bbbc97ff537bada6f341066750a42de5a60e0985a39",
  href: "https://explorer.test/contract/03a38b",
};

const OPEN_LEDGER: LedgerSnapshot = {
  boardStatus: "Open",
  sequence: 42,
  completed: 0,
  ownerCommitment: "0x7a3b…c19f",
};

const ACTIVE_LEDGER: LedgerSnapshot = {
  boardStatus: "Active",
  sequence: 1,
  completed: 0,
  ownerCommitment: "7f4a…91d2",
};

const COMPLETED_LEDGER: LedgerSnapshot = {
  boardStatus: "Completed",
  sequence: 2,
  completed: 1,
  ownerCommitment: "7f91c2…4e18",
};

function disconnectedView(): DisconnectedViewModel {
  return {
    phase: "disconnected",
    wallet: { status: "disconnected" },
    network: "Preprod",
    contract: CONTRACT,
    draft: "Ship the VeilPledge beta",
    ledger: OPEN_LEDGER,
  };
}

function connectingView(): ConnectingViewModel {
  return {
    ...disconnectedView(),
    phase: "connecting",
    wallet: { status: "connecting" },
  };
}

function connectedOpenView(): ConnectedOpenViewModel {
  return {
    ...disconnectedView(),
    phase: "connected-open",
    wallet: {
      status: "connected",
      address: "addr1q9privatewallet7K2D",
    },
  };
}

function connectedActiveView(
  isOwner: boolean,
  ownerMessage?: string,
): ConnectedActiveViewModel {
  return {
    phase: "connected-active",
    wallet: {
      status: "connected",
      address: "addr1q9privatewallet7K2D",
    },
    network: "Preprod",
    contract: CONTRACT,
    pledgeText: "Ship the VeilPledge beta",
    isOwner,
    ownerMessage,
    ledger: ACTIVE_LEDGER,
  };
}

function busyView(
  operation: BusyViewModel["operation"],
  pledgeText?: string,
): BusyViewModel {
  return {
    phase: "busy",
    wallet: {
      status: "connected",
      address: "addr1q9privatewallet7K2D",
    },
    network: "Preprod",
    contract: CONTRACT,
    operation,
    ...(pledgeText
      ? { pledgeText }
      : { draft: "Ship the VeilPledge beta" }),
    ledger: pledgeText ? ACTIVE_LEDGER : OPEN_LEDGER,
  };
}

function successView(): SuccessViewModel {
  return {
    phase: "success",
    outcome: "completed",
    wallet: {
      status: "connected",
      address: "addr1q9privatewallet7K2D",
    },
    network: "Preprod",
    contract: CONTRACT,
    pledgeText: "Ship the VeilPledge beta",
    transaction: {
      label: "0xe549…6ab2",
      hash: "e5495322fad11d200849f5be76d8b475b4019f8331bd4318a5a5a8a9fc996ab2",
      href: "https://explorer.test/tx/e549",
      blockHeight: "1,545,814",
      previousCommitment: "03a38b…a39",
      newSequence: 2,
    },
    ledger: COMPLETED_LEDGER,
  };
}

function errorView(overrides: Partial<ErrorViewModel> = {}): ErrorViewModel {
  return {
    phase: "error",
    wallet: { status: "disconnected" },
    network: "Preprod",
    contract: CONTRACT,
    title: "Authorization was not approved",
    message: "Nothing was submitted. You can try the wallet request again.",
    noticeKind: "rejected",
    draft: "Ship the VeilPledge beta",
    ledger: OPEN_LEDGER,
    ...overrides,
  };
}

function renderApp(
  viewModel: VeilPledgeViewModel,
  actions: VeilPledgeActions = {},
) {
  return render(<App actions={actions} viewModel={viewModel} />);
}

function normalizeCopy(value: string | null) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function visibleCopyFor(element: Element) {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((breakElement) => {
    breakElement.replaceWith(" ");
  });
  return normalizeCopy(clone.textContent);
}

/**
 * Returns the smallest DOM elements that contain visible text. This makes the
 * accepted concept's copy inventory strict without counting the same sentence
 * again through each of its wrapper elements.
 */
function atomicVisibleCopy(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("*"))
    .filter((element) => {
      if (!visibleCopyFor(element)) return false;

      return !Array.from(element.children).some((child) =>
        Boolean(visibleCopyFor(child)),
      );
    })
    .map(visibleCopyFor);
}

describe("VeilPledge application states", () => {
  it("renders the accepted disconnected/open concept with an exact copy inventory", () => {
    const { container } = renderApp(disconnectedView());

    expect(screen.getByLabelText("VeilPledge home")).toBeInTheDocument();
    expect(screen.getByLabelText("Network and contract")).toHaveTextContent(
      "Preprod",
    );
    expect(
      screen.getByRole("link", {
        name: `Open Preprod explorer; contract ${CONTRACT.value}`,
      }),
    ).toHaveAttribute("href", CONTRACT.href);
    expect(
      screen.getByRole("button", { name: "Connect Lace" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /Make it public\.\s*Keep ownership private\./,
      }),
    ).toBeInTheDocument();

    const pledgeInput = screen.getByRole("textbox", {
      name: "What will you finish?",
    });
    expect(pledgeInput).toHaveValue("Ship the VeilPledge beta");
    expect(pledgeInput).toHaveAttribute("maxlength", "280");
    expect(pledgeInput).toHaveAccessibleDescription(
      "24 / 280 Your secret is encrypted at rest in this browser profile. Only its commitment reaches the ledger.",
    );
    expect(
      screen.getByRole("button", { name: "Create private pledge" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("region", {
        name: "Public and private data boundary",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Public pledge ledger snapshot" }),
    ).toBeInTheDocument();

    expect(atomicVisibleCopy(container)).toEqual([
      "VeilPledge",
      "Preprod",
      "03a38b…5a39",
      "Connect Lace",
      "Make it public. Keep ownership private.",
      "Publish a pledge anyone can verify. Complete it later with a zero-knowledge proof that never reveals your secret.",
      "What will you finish?",
      "Ship the VeilPledge beta",
      "24 / 280",
      "Create private pledge",
      "Your secret is encrypted at rest in this browser profile. Only its commitment reaches the ledger.",
      "What the network sees",
      "Pledge text",
      "Board status",
      "Sequence",
      "Completion count",
      "Owner commitment",
      "What stays with you",
      "Owner secret",
      "Wallet signing keys",
      "Ownership witness",
      "Board status",
      "Open",
      "Sequence",
      "42",
      "Completed",
      "0",
      "Owner commitment",
      "0x7a3b…c19f",
    ]);
  });

  it("routes disconnected actions to their callbacks", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const onDraftChange = vi.fn();
    const onCreatePledge = vi.fn();
    const onCopyCommitment = vi.fn();

    renderApp(disconnectedView(), {
      onConnect,
      onDraftChange,
      onCreatePledge,
      onCopyCommitment,
    });

    await user.click(screen.getByRole("button", { name: "Connect Lace" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "What will you finish?" }),
      { target: { value: "Publish the first private pledge" } },
    );
    await user.click(
      screen.getByRole("button", { name: "Create private pledge" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Copy owner commitment" }),
    );

    expect(onConnect).toHaveBeenCalledOnce();
    expect(onDraftChange).toHaveBeenCalledWith(
      "Publish the first private pledge",
    );
    expect(onCreatePledge).toHaveBeenCalledOnce();
    expect(onCopyCommitment).toHaveBeenCalledWith("0x7a3b…c19f");
  });

  it("prevents duplicate wallet and create requests while connecting", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const onCreatePledge = vi.fn();

    renderApp(connectingView(), { onConnect, onCreatePledge });

    const main = screen.getByRole("main");
    const connectButton = screen.getByRole("button", { name: "Connecting…" });
    const createButton = screen.getByRole("button", {
      name: "Connecting to Lace…",
    });

    expect(main).toHaveAttribute("aria-busy", "true");
    expect(connectButton).toBeDisabled();
    expect(createButton).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "What will you finish?" }),
    ).toBeDisabled();

    await user.click(connectButton);
    await user.click(createButton);
    expect(onConnect).not.toHaveBeenCalled();
    expect(onCreatePledge).not.toHaveBeenCalled();
  });

  it("renders connected/open controls and routes disconnect, edit, and create", async () => {
    const user = userEvent.setup();
    const onDisconnect = vi.fn();
    const onDraftChange = vi.fn();
    const onCreatePledge = vi.fn();

    renderApp(connectedOpenView(), {
      onDisconnect,
      onDraftChange,
      onCreatePledge,
    });

    const walletSummary = screen.getByRole("group", {
      name: "Connected wallet addr1q9privatewallet7K2D",
    });
    expect(walletSummary).toHaveAttribute(
      "title",
      "addr1q9privatewallet7K2D",
    );
    expect(walletSummary).toHaveTextContent("addr1q…7K2D");
    const disconnectButton = screen.getByRole("button", {
      name: "Disconnect",
    });
    const pledgeInput = screen.getByRole("textbox", {
      name: "What will you finish?",
    });
    const createButton = screen.getByRole("button", {
      name: "Create private pledge",
    });

    expect(pledgeInput).toBeEnabled();
    expect(createButton).toBeEnabled();
    fireEvent.change(pledgeInput, { target: { value: "Finish Level 2" } });
    await user.click(createButton);
    await user.click(disconnectButton);

    expect(onDraftChange).toHaveBeenCalledWith("Finish Level 2");
    expect(onCreatePledge).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("enables private completion for the connected owner", async () => {
    const user = userEvent.setup();
    const onCompletePledge = vi.fn();

    renderApp(connectedActiveView(true), { onCompletePledge });

    const activePledge = screen.getByRole("region", { name: "Active pledge" });
    expect(
      within(activePledge).getByText("Ship the VeilPledge beta"),
    ).toBeInTheDocument();
    expect(within(activePledge).getByText("Ready to prove")).toBeInTheDocument();
    expect(activePledge).toHaveTextContent(
      "Your secret is encrypted at rest in this browser profile. Only its commitment reaches the ledger.",
    );

    const completeButton = within(activePledge).getByRole("button", {
      name: "Prove ownership & complete",
    });
    expect(completeButton).toBeEnabled();
    await user.click(completeButton);
    expect(onCompletePledge).toHaveBeenCalledOnce();
  });

  it("keeps completion disabled and explains privacy for a connected non-owner", async () => {
    const user = userEvent.setup();
    const onCompletePledge = vi.fn();
    const ownerMessage =
      "Only the private owner can generate this completion proof.";

    renderApp(connectedActiveView(false, ownerMessage), { onCompletePledge });

    const activePledge = screen.getByRole("region", { name: "Active pledge" });
    const completeButton = within(activePledge).getByRole("button", {
      name: "Prove ownership & complete",
    });

    expect(within(activePledge).queryByText("Ready to prove")).not.toBeInTheDocument();
    expect(within(activePledge).getByText(ownerMessage)).toBeInTheDocument();
    expect(completeButton).toBeDisabled();
    await user.click(completeButton);
    expect(onCompletePledge).not.toHaveBeenCalled();
  });

  it.each([
    {
      operation: "creating",
      pledgeText: undefined,
      actionName: "Creating pledge…",
      panelName: "Creating private pledge",
    },
    {
      operation: "proving",
      pledgeText: "Ship the VeilPledge beta",
      actionName: "Generating proof…",
      panelName: "Proving private ownership",
    },
    {
      operation: "submitting",
      pledgeText: "Ship the VeilPledge beta",
      actionName: "Submitting proof…",
      panelName: "Submitting proof to Preprod",
    },
  ] as const)(
    "renders explicit, non-interactive $operation progress",
    async ({ operation, pledgeText, actionName, panelName }) => {
      const user = userEvent.setup();
      const onCreatePledge = vi.fn();
      const onCompletePledge = vi.fn();

      renderApp(busyView(operation, pledgeText), {
        onCreatePledge,
        onCompletePledge,
      });

      expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
      const progressPanel = screen.getByRole("region", { name: panelName });
      expect(progressPanel).toHaveAttribute("aria-live", "polite");
      expect(progressPanel).toHaveAttribute("aria-busy", "true");

      const action = screen.getByRole("button", { name: actionName });
      expect(action).toBeDisabled();
      await user.click(action);
      expect(onCreatePledge).not.toHaveBeenCalled();
      expect(onCompletePledge).not.toHaveBeenCalled();
    },
  );

  it("renders verifiable success evidence and starts another pledge", async () => {
    const user = userEvent.setup();
    const onMakeAnotherPledge = vi.fn();

    renderApp(successView(), { onMakeAnotherPledge });

    const success = screen.getByRole("region", {
      name: "Pledge completed privately",
    });
    expect(success).toHaveTextContent(
      "The network verified ownership without learning your secret.",
    );
    expect(
      within(success).getByRole("link", {
        name: "Open Preprod explorer; transaction e5495322fad11d200849f5be76d8b475b4019f8331bd4318a5a5a8a9fc996ab2",
      }),
    ).toHaveAttribute("href", "https://explorer.test/tx/e549");
    expect(success).toHaveTextContent("Block height1,545,814");
    expect(success).toHaveTextContent("Previous commitment03a38b…a39");
    expect(success).toHaveTextContent("New sequence2");
    expect(success).toHaveTextContent("Secret disclosed: Never");
    expect(within(success).getByLabelText("Protected")).toBeInTheDocument();
    expect(screen.getByText("Completed", { selector: "dd" })).toBeInTheDocument();
    expect(
      screen.getByText("Ownership proved · pledge complete"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Prove ownership & complete" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(success).getByRole("button", { name: "Make another pledge" }),
    );
    expect(onMakeAnotherPledge).toHaveBeenCalledOnce();
  });

  it("renders one error alert and routes recovery actions", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const onCreatePledge = vi.fn();
    const onRetry = vi.fn();

    renderApp(errorView({ retryLabel: "Request Lace again" }), {
      onConnect,
      onCreatePledge,
      onRetry,
    });

    const alert = screen.getByRole("alert", {
      name: "Authorization was not approved",
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(alert).toHaveTextContent(
      "Nothing was submitted. You can try the wallet request again.",
    );

    await user.click(screen.getByRole("button", { name: "Connect Lace" }));
    await user.click(
      screen.getByRole("button", { name: "Create private pledge" }),
    );
    await user.click(
      within(alert).getByRole("button", { name: "Request Lace again" }),
    );

    expect(onConnect).toHaveBeenCalledOnce();
    expect(onCreatePledge).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("blocks write controls when Lace is on the wrong network", async () => {
    const user = userEvent.setup();
    const onCreatePledge = vi.fn();

    renderApp(
      errorView({
        wallet: {
          status: "connected",
          address: "addr1q9privatewallet7K2D",
        },
        noticeKind: "wrong-network",
        title: "Switch Lace to Preprod",
        message:
          "Writes stay blocked until your wallet is using the Preprod network.",
      }),
      { onCreatePledge },
    );

    const pledgeInput = screen.getByRole("textbox", {
      name: "What will you finish?",
    });
    const createButton = screen.getByRole("button", {
      name: "Create private pledge",
    });

    expect(pledgeInput).toBeDisabled();
    expect(createButton).toBeDisabled();
    await user.click(createButton);
    expect(onCreatePledge).not.toHaveBeenCalled();
  });

  it("does not infer pledge ownership from a connected wallet after an error", () => {
    renderApp(
      errorView({
        wallet: {
          status: "connected",
          address: "addr1q9privatewallet7K2D",
        },
        pledgeText: "Ship the VeilPledge beta",
        draft: undefined,
      }),
    );

    const activePledge = screen.getByRole("region", { name: "Active pledge" });
    expect(
      within(activePledge).getByRole("button", {
        name: "Prove ownership & complete",
      }),
    ).toBeDisabled();
    expect(within(activePledge).queryByText("Ready to prove")).not.toBeInTheDocument();
  });
});

describe("wallet-specific error copy", () => {
  it.each([
    [
      "lace-missing",
      "Lace wallet not found",
      "Install or enable Lace, then return here to connect on Preprod.",
    ],
    [
      "wrong-network",
      "Switch Lace to Preprod",
      "Writes stay blocked until your wallet is using the Preprod network.",
    ],
    [
      "rejected",
      "Authorization was not approved",
      "Nothing was submitted. You can try the wallet request again.",
    ],
    [
      "disconnected",
      "Disconnected locally",
      "To revoke authorization completely, remove VeilPledge inside Lace.",
    ],
    [
      "generic",
      "Action could not be completed",
      "Review the details and try again when you are ready.",
    ],
  ] as const)("uses concise %s notice copy", (kind, title, message) => {
    render(<WalletNotice kind={kind} />);

    const notice = screen.getByRole("status");
    expect(within(notice).getByText(title)).toBeInTheDocument();
    expect(within(notice).getByText(message)).toBeInTheDocument();
  });
});
