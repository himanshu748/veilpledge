import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyControl } from "../components/CopyControl";
import { LedgerRail } from "../components/LedgerRail";
import { TransactionPanel } from "../components/TransactionPanel";
import "../styles.css";

afterEach(cleanup);

describe("CopyControl", () => {
  it("keeps the initial copy inventory unchanged and exposes a 40px target", () => {
    const { container } = render(
      <CopyControl
        failureMessage="Could not copy value."
        label="Copy value"
        onCopy={vi.fn()}
        successMessage="Value copied."
        value="full-value"
      />,
    );

    const button = screen.getByRole("button", { name: "Copy value" });
    const feedback = screen.getByRole("status");
    const styles = globalThis.getComputedStyle(button);

    expect(container.textContent).toBe("");
    expect(button).toHaveAttribute("title", "Copy value");
    expect(button).toHaveAttribute("data-copy-state", "idle");
    expect(Number.parseFloat(styles.width)).toBeGreaterThanOrEqual(40);
    expect(Number.parseFloat(styles.height)).toBeGreaterThanOrEqual(40);
    expect(feedback).toBeEmptyDOMElement();
    expect(feedback).toHaveAttribute("aria-live", "polite");
    expect(feedback).toHaveAttribute("aria-atomic", "true");
  });

  it("announces confirmed success without changing the button name", async () => {
    const user = userEvent.setup();
    let resolveCopy!: () => void;
    const onCopy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );

    render(
      <CopyControl
        failureMessage="Could not copy value."
        label="Copy value"
        onCopy={onCopy}
        successMessage="Value copied."
        value="full-value"
      />,
    );

    const button = screen.getByRole("button", { name: "Copy value" });
    await user.click(button);

    expect(onCopy).toHaveBeenCalledWith("full-value");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    resolveCopy();

    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAccessibleName("Copy value");
    expect(button).toHaveAccessibleDescription("Value copied.");
    expect(button).toHaveAttribute("data-copy-state", "success");
    expect(button).toHaveAttribute("title", "Value copied.");
    expect(screen.getByRole("status")).toHaveTextContent("Value copied.");
  });

  it("announces failure and remains available for a retry", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockRejectedValue(new Error("permission denied"));

    render(
      <CopyControl
        failureMessage="Could not copy value."
        label="Copy value"
        onCopy={onCopy}
        successMessage="Value copied."
        value="full-value"
      />,
    );

    const button = screen.getByRole("button", { name: "Copy value" });
    await user.click(button);

    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName("Copy value");
    expect(button).toHaveAccessibleDescription("Could not copy value.");
    expect(button).toHaveAttribute("data-copy-state", "error");
    expect(button).toHaveAttribute("title", "Could not copy value.");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Could not copy value.",
    );
  });
});

describe("copy surfaces", () => {
  it("copies the full owner commitment instead of its shortened label", async () => {
    const user = userEvent.setup();
    const onCopyCommitment = vi.fn().mockResolvedValue(undefined);

    render(
      <LedgerRail
        ledger={{
          boardStatus: "Active",
          sequence: 7,
          completed: 0,
          ownerCommitment: "full-owner-commitment",
          ownerCommitmentLabel: "full…ment",
        }}
        onCopyCommitment={onCopyCommitment}
      />,
    );

    const ledger = screen.getByRole("region", {
      name: "Public pledge ledger snapshot",
    });
    const button = within(ledger).getByRole("button", {
      name: "Copy owner commitment",
    });

    expect(ledger).toHaveTextContent("full…ment");
    expect(button).toHaveAttribute("title", "Copy owner commitment");
    expect(within(ledger).getByRole("status")).toBeEmptyDOMElement();

    await user.click(button);

    expect(onCopyCommitment).toHaveBeenCalledWith("full-owner-commitment");
    expect(within(ledger).getByRole("status")).toHaveTextContent(
      "Owner commitment copied.",
    );
  });

  it("copies the full transaction hash and announces success", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(globalThis.navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(
      <TransactionPanel
        mode="success"
        outcome="completed"
        transaction={{
          label: "abcd…7890",
          hash: "abcdef1234567890",
          href: "https://explorer.test/tx/abcdef",
          blockHeight: "1,545,814",
          previousCommitment: "0123…4567",
          newSequence: 2,
        }}
      />,
    );

    const panel = screen.getByRole("region", {
      name: "Pledge completed privately",
    });
    const button = within(panel).getByRole("button", {
      name: "Copy transaction hash",
    });

    expect(button).toHaveAttribute("title", "Copy transaction hash");
    expect(within(panel).getByRole("status")).toBeEmptyDOMElement();

    await user.click(button);

    expect(writeText).toHaveBeenCalledWith("abcdef1234567890");
    expect(within(panel).getByRole("status")).toHaveTextContent(
      "Transaction hash copied.",
    );
  });

  it("announces a rejected transaction clipboard write", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis.navigator.clipboard, "writeText").mockRejectedValue(
      new Error("permission denied"),
    );

    render(
      <TransactionPanel
        mode="success"
        outcome="created"
        transaction={{
          label: "abcd…7890",
          hash: "abcdef1234567890",
          blockHeight: "1,545,814",
          previousCommitment: "0123…4567",
          newSequence: 2,
        }}
      />,
    );

    const panel = screen.getByRole("region", {
      name: "Pledge created privately",
    });
    const button = within(panel).getByRole("button", {
      name: "Copy transaction hash",
    });

    await user.click(button);

    expect(button).toHaveAttribute("data-copy-state", "error");
    expect(button).toHaveAccessibleDescription(
      "Could not copy transaction hash.",
    );
    expect(within(panel).getByRole("status")).toHaveTextContent(
      "Could not copy transaction hash.",
    );
  });
});
