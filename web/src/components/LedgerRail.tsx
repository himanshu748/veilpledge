import {
  CheckCircle2,
  Copy,
  Fingerprint,
  Grid2X2,
  Hash,
  List,
} from "lucide-react";

import type { LedgerSnapshot } from "../types";

interface LedgerRailProps {
  ledger: LedgerSnapshot;
  onCopyCommitment?: (commitment: string) => void;
}

export function LedgerRail({ ledger, onCopyCommitment }: LedgerRailProps) {
  const items = [
    {
      label: "Board status",
      value: ledger.boardStatus,
      icon: Grid2X2,
      tone:
        ledger.boardStatus === "Completed"
          ? "success"
          : ledger.boardStatus === "Unavailable"
            ? "danger"
            : "default",
    },
    { label: "Sequence", value: ledger.sequence, icon: List, tone: "default" },
    {
      label: "Completed",
      value: ledger.completed,
      icon: CheckCircle2,
      tone: "default",
    },
  ] as const;

  return (
    <section className="ledger-rail" aria-label="Public pledge ledger snapshot">
      <dl className="ledger-rail__list">
        {items.map(({ label, value, icon: ItemIcon, tone }) => (
          <div className={`ledger-item ledger-item--${tone}`} key={label}>
            <span className="ledger-item__icon" aria-hidden="true">
              <ItemIcon size={27} strokeWidth={1.5} />
            </span>
            <div>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          </div>
        ))}

        <div className="ledger-item ledger-item--commitment">
          <span className="ledger-item__icon" aria-hidden="true">
            <Fingerprint className="ledger-item__fingerprint" size={28} strokeWidth={1.5} />
            <Hash className="ledger-item__hash" size={27} strokeWidth={1.5} />
          </span>
          <div>
            <dt>Owner commitment</dt>
            <dd className="ledger-item__commitment-value">
              <span title={ledger.ownerCommitment}>
                {ledger.ownerCommitmentLabel ?? ledger.ownerCommitment}
              </span>
              {onCopyCommitment ? (
                <button
                  aria-label="Copy owner commitment"
                  className="copy-button"
                  onClick={() => onCopyCommitment(ledger.ownerCommitment)}
                  title="Copy owner commitment"
                  type="button"
                >
                  <Copy aria-hidden="true" size={18} strokeWidth={1.5} />
                </button>
              ) : null}
            </dd>
          </div>
        </div>
      </dl>
    </section>
  );
}
