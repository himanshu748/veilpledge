export type WalletView =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; address: string };

export interface ContractReference {
  label: string;
  value?: string;
  href?: string;
}

export interface LedgerSnapshot {
  boardStatus: "Loading" | "Open" | "Active" | "Completed" | "Unavailable";
  sequence: number | string;
  completed: number | string;
  ownerCommitment: string;
  ownerCommitmentLabel?: string;
}

interface BaseViewModel {
  network: string;
  contract: ContractReference;
  ledger: LedgerSnapshot;
}

export interface DisconnectedViewModel extends BaseViewModel {
  phase: "disconnected";
  wallet: { status: "disconnected" };
  draft: string;
}

export interface ConnectingViewModel extends BaseViewModel {
  phase: "connecting";
  wallet: { status: "connecting" };
  draft: string;
}

export interface ConnectedOpenViewModel extends BaseViewModel {
  phase: "connected-open";
  wallet: { status: "connected"; address: string };
  draft: string;
}

export interface ConnectedActiveViewModel extends BaseViewModel {
  phase: "connected-active";
  wallet: { status: "connected"; address: string };
  pledgeText: string;
  isOwner: boolean;
  ownerMessage?: string;
}

export interface PublicActiveViewModel extends BaseViewModel {
  phase: "public-active";
  wallet: { status: "disconnected" };
  pledgeText: string;
  isOwner: false;
  ownerMessage?: string;
}

export interface BusyViewModel extends BaseViewModel {
  phase: "busy";
  wallet: { status: "connected"; address: string };
  operation: "creating" | "proving" | "submitting";
  draft?: string;
  pledgeText?: string;
  progressMessage?: string;
}

export interface SuccessTransaction {
  label: string;
  hash: string;
  href?: string;
  blockHeight: number | string;
  previousCommitment: string;
  newSequence: number | string;
}

export interface SuccessViewModel extends BaseViewModel {
  phase: "success";
  outcome: "created" | "completed";
  wallet: { status: "connected"; address: string };
  pledgeText: string;
  transaction: SuccessTransaction;
}

export type WalletNoticeKind =
  | "lace-missing"
  | "wrong-network"
  | "rejected"
  | "disconnected"
  | "generic";

export interface ErrorViewModel extends BaseViewModel {
  phase: "error";
  wallet: WalletView;
  title: string;
  message: string;
  noticeKind?: WalletNoticeKind;
  draft?: string;
  pledgeText?: string;
  isOwner?: boolean;
  ownerMessage?: string;
  retryLabel?: string;
}

export type VeilPledgeViewModel =
  | DisconnectedViewModel
  | ConnectingViewModel
  | ConnectedOpenViewModel
  | ConnectedActiveViewModel
  | PublicActiveViewModel
  | BusyViewModel
  | SuccessViewModel
  | ErrorViewModel;

export interface VeilPledgeActions {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onDraftChange?: (value: string) => void;
  onCreatePledge?: () => void;
  onCompletePledge?: () => void;
  onMakeAnotherPledge?: () => void;
  onRetry?: () => void;
  onCopyCommitment?: (commitment: string) => Promise<void> | void;
}

export interface VeilPledgeAppProps {
  viewModel?: VeilPledgeViewModel;
  actions?: VeilPledgeActions;
}
