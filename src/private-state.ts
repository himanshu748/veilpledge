import { randomBytes } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

export const PRIVATE_STATE_ID = 'veilpledge-private-state';
export const PRIVATE_STATE_STORE = 'veilpledge-state';

export type VeilPledgePrivateState = {
  readonly secretKey: Uint8Array;
};

export function createVeilPledgePrivateState(
  secretKey: Uint8Array = randomBytes(32),
): VeilPledgePrivateState {
  if (secretKey.length !== 32) {
    throw new Error(`VeilPledge secret must be 32 bytes; received ${secretKey.length}`);
  }

  return { secretKey: Uint8Array.from(secretKey) };
}

export const witnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<unknown, VeilPledgePrivateState>): [
    VeilPledgePrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],
};
