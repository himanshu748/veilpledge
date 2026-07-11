import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import type { SuccessTransaction } from "../types";

type TransactionPanelProps =
  | {
      mode: "busy";
      operation: "creating" | "proving" | "submitting";
      message?: string;
    }
  | {
      mode: "success";
      outcome: "created" | "completed";
      transaction: SuccessTransaction;
      onMakeAnother?: () => void;
    }
  | {
      mode: "error";
      title: string;
      message: string;
      retryLabel?: string;
      onRetry?: () => void;
    };

const busyCopy = {
  creating: {
    title: "Creating private pledge",
    message: "Encrypting your secret and preparing its public commitment.",
  },
  proving: {
    title: "Proving private ownership",
    message: "Lace is preparing a zero-knowledge ownership proof.",
  },
  submitting: {
    title: "Submitting proof to Preprod",
    message: "Waiting for the network to confirm your private completion.",
  },
} as const;

export function TransactionPanel(props: TransactionPanelProps) {
  if (props.mode === "success") {
    const { transaction } = props;
    const completed = props.outcome === "completed";

    return (
      <section
        aria-labelledby="transaction-success-title"
        className="transaction-panel transaction-panel--success"
      >
        <div className="transaction-panel__heading">
          <span className="transaction-panel__status-icon transaction-panel__status-icon--success">
            <Check aria-hidden="true" size={28} strokeWidth={1.8} />
          </span>
          <h2 id="transaction-success-title">
            {completed ? "Pledge completed privately" : "Pledge created privately"}
          </h2>
        </div>

        <p className="transaction-panel__lead">
          {completed
            ? "The network verified ownership without learning your secret."
            : "The network stored your pledge and commitment without learning your secret."}
        </p>

        <div className="transaction-link-row">
          {transaction.href ? (
            <a
              aria-label={`Open Preprod explorer; transaction ${transaction.hash}`}
              className="transaction-link"
              href={transaction.href}
              rel="noreferrer"
              target="_blank"
              title={transaction.hash}
            >
              <span aria-hidden="true">View transaction {transaction.label}</span>
              <ExternalLink aria-hidden="true" size={20} strokeWidth={1.5} />
            </a>
          ) : (
            <span
              aria-label={`Transaction ${transaction.hash}`}
              className="transaction-link transaction-link--static"
              role="group"
              title={transaction.hash}
            >
              <span aria-hidden="true">View transaction {transaction.label}</span>
            </span>
          )}
          <button
            aria-label="Copy transaction hash"
            className="copy-button"
            onClick={() => void globalThis.navigator?.clipboard?.writeText(transaction.hash)}
            title="Copy transaction hash"
            type="button"
          >
            <Copy aria-hidden="true" size={18} strokeWidth={1.5} />
          </button>
        </div>

        <dl className="transaction-panel__block">
          <dt>Block height</dt>
          <dd>{transaction.blockHeight}</dd>
        </dl>

        <button
          className="secondary-action"
          onClick={props.onMakeAnother}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={21} strokeWidth={1.5} />
          {completed ? "Make another pledge" : "Continue to active pledge"}
        </button>

        <dl className="transaction-evidence">
          <div>
            <dt>Previous commitment</dt>
            <dd>{transaction.previousCommitment}</dd>
          </div>
          <div>
            <dt>New sequence</dt>
            <dd>{transaction.newSequence}</dd>
          </div>
          <div>
            <dt>Secret disclosed: Never</dt>
            <dd>
              <ShieldCheck aria-label="Protected" size={24} strokeWidth={1.5} />
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  if (props.mode === "error") {
    return (
      <section
        aria-labelledby="transaction-error-title"
        className="transaction-panel transaction-panel--error"
        role="alert"
      >
        <div className="transaction-panel__heading">
          <span className="transaction-panel__status-icon transaction-panel__status-icon--error">
            <AlertCircle aria-hidden="true" size={27} strokeWidth={1.6} />
          </span>
          <h2 id="transaction-error-title">{props.title}</h2>
        </div>
        <p className="transaction-panel__lead">{props.message}</p>
        {props.onRetry ? (
          <button className="secondary-action" onClick={props.onRetry} type="button">
            <RefreshCw aria-hidden="true" size={21} strokeWidth={1.5} />
            {props.retryLabel ?? "Try again"}
          </button>
        ) : null}
      </section>
    );
  }

  const copy = busyCopy[props.operation];

  return (
    <section
      aria-labelledby="transaction-busy-title"
      aria-live="polite"
      aria-busy="true"
      className="transaction-panel transaction-panel--busy"
    >
      <div className="transaction-panel__heading">
        <span className="transaction-panel__status-icon transaction-panel__status-icon--busy">
          <Loader2 aria-hidden="true" className="spin" size={28} strokeWidth={1.5} />
        </span>
        <h2 id="transaction-busy-title">{copy.title}</h2>
      </div>
      <p className="transaction-panel__lead">{props.message ?? copy.message}</p>

      <div className="proof-progress" aria-hidden="true">
        <span className="proof-progress__line" />
        <span className="proof-progress__dot proof-progress__dot--done">
          <Check size={13} strokeWidth={2} />
        </span>
        <span className="proof-progress__dot proof-progress__dot--active" />
        <span className="proof-progress__dot" />
      </div>

      <p className="transaction-panel__privacy">
        <CheckCircle2 aria-hidden="true" size={21} strokeWidth={1.5} />
        Your secret is never written to the public ledger.
      </p>
    </section>
  );
}
