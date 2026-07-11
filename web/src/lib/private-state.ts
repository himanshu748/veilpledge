import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import type { PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";
import { validatePassword } from "@midnight-ntwrk/midnight-js-utils";

import {
  VEILPLEDGE_PRIVATE_STATE_ID,
  VEILPLEDGE_PRIVATE_STATE_STORE,
  VEILPLEDGE_SIGNING_KEY_STORE,
  type VeilPledgePrivateState,
} from "./contract";

const VAULT_KEY_PREFIX = "veilpledge:vault-password:v1";
const OWNERSHIP_KEY_PREFIX = "veilpledge:ownership:v1";

export type PersistentBrowserStorage = Pick<Storage, "getItem" | "setItem">;

export interface LocalOwnershipRecord {
  readonly sequence: string;
  readonly txId: string;
  readonly blockHeight: number;
}

type OwnershipDocument = {
  readonly version: 1;
  readonly records: Record<string, LocalOwnershipRecord>;
};

const requireWebCrypto = (): Crypto => {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto.subtle) {
    throw new Error("VeilPledge requires WebCrypto in a secure browser context.");
  }
  return globalThis.crypto;
};

const getBrowserStorage = (storage?: PersistentBrowserStorage): PersistentBrowserStorage => {
  if (storage) return storage;
  if (!globalThis.localStorage) {
    throw new Error("Persistent browser storage is unavailable.");
  }
  return globalThis.localStorage;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const storageScope = async (...parts: readonly string[]): Promise<string> => {
  const crypto = requireWebCrypto();
  const material = new TextEncoder().encode(parts.join("\u0000"));
  const digest = await crypto.subtle.digest("SHA-256", material);
  return bytesToHex(new Uint8Array(digest));
};

export const withPrivateStateInitializationLock = async <T>(
  accountId: string,
  contractAddress: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const locks = globalThis.navigator?.locks;
  if (!locks) return operation();
  const scope = await storageScope(accountId, contractAddress);
  return locks.request(`veilpledge:private-state:${scope}`, operation);
};

const readAndValidatePassword = (value: string, storageKey: string): string => {
  try {
    validatePassword(value);
    return value;
  } catch (error) {
    throw new Error(
      `The local VeilPledge vault at ${storageKey} is invalid; refusing to replace it.`,
      { cause: error },
    );
  }
};

const generateVaultPassword = (): string => {
  const crypto = requireWebCrypto();

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const entropy = crypto.getRandomValues(new Uint8Array(32));
    const candidate = `Vp1!${bytesToBase64Url(entropy)}`;
    try {
      validatePassword(candidate);
      return candidate;
    } catch {
      // An extremely unlikely random sequential/repeated pattern can violate
      // the SDK policy. Sample fresh entropy instead of weakening the policy.
    }
  }

  throw new Error("Unable to generate a valid local VeilPledge vault password.");
};

/**
 * Returns the durable, application-generated encryption password for one Lace
 * account. Existing material is validated and returned verbatim; it is never
 * silently replaced, which keeps reconnects able to decrypt their prior state.
 */
export const getOrCreateVaultPassword = async (
  accountId: string,
  storage?: PersistentBrowserStorage,
): Promise<string> => {
  if (!accountId.trim()) throw new Error("A Lace account ID is required for private state.");

  const browserStorage = getBrowserStorage(storage);
  const key = `${VAULT_KEY_PREFIX}:${await storageScope(accountId)}`;
  const initialize = (): string => {
    const existing = browserStorage.getItem(key);
    if (existing !== null) return readAndValidatePassword(existing, key);

    const generated = generateVaultPassword();
    browserStorage.setItem(key, generated);
    const persisted = browserStorage.getItem(key);
    if (persisted === null) throw new Error("The browser did not persist the VeilPledge vault.");
    return readAndValidatePassword(persisted, key);
  };

  // Web Locks serializes first-use initialization between tabs. The fallback
  // still preserves reconnect behavior in browsers that do not expose Locks.
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request(`veilpledge:${key}`, initialize) : initialize();
};

export const createVeilPledgePrivateState = (): VeilPledgePrivateState => ({
  secretKey: requireWebCrypto().getRandomValues(new Uint8Array(32)),
});

export const createVeilPledgePrivateStateProvider = async (
  accountId: string,
  storage?: PersistentBrowserStorage,
): Promise<
  PrivateStateProvider<
    typeof VEILPLEDGE_PRIVATE_STATE_ID,
    VeilPledgePrivateState
  >
> => {
  const vaultPassword = await getOrCreateVaultPassword(accountId, storage);

  return levelPrivateStateProvider<
    typeof VEILPLEDGE_PRIVATE_STATE_ID,
    VeilPledgePrivateState
  >({
    accountId,
    privateStateStoreName: VEILPLEDGE_PRIVATE_STATE_STORE,
    signingKeyStoreName: VEILPLEDGE_SIGNING_KEY_STORE,
    privateStoragePasswordProvider: () => vaultPassword,
  });
};

const isOwnershipRecord = (value: unknown): value is LocalOwnershipRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<LocalOwnershipRecord>;
  return (
    typeof record.sequence === "string" &&
    /^\d+$/u.test(record.sequence) &&
    typeof record.txId === "string" &&
    record.txId.length > 0 &&
    typeof record.blockHeight === "number" &&
    Number.isSafeInteger(record.blockHeight) &&
    record.blockHeight >= 0
  );
};

const parseOwnershipDocument = (serialized: string | null): OwnershipDocument => {
  if (serialized === null) return { version: 1, records: {} };

  try {
    const value = JSON.parse(serialized) as Partial<OwnershipDocument>;
    if (value.version !== 1 || !value.records || typeof value.records !== "object") {
      throw new TypeError("Unsupported ownership document");
    }
    if (!Object.values(value.records).every(isOwnershipRecord)) {
      throw new TypeError("Invalid ownership record");
    }
    return value as OwnershipDocument;
  } catch (error) {
    throw new Error("Local VeilPledge ownership metadata is corrupt; refusing to overwrite it.", {
      cause: error,
    });
  }
};

/** Account-and-contract scoped, non-secret ownership history keyed by round sequence. */
export class LocalOwnershipStore {
  private constructor(
    private readonly storage: PersistentBrowserStorage,
    private readonly storageKey: string,
  ) {}

  static async create(
    accountId: string,
    contractAddress: string,
    storage?: PersistentBrowserStorage,
  ): Promise<LocalOwnershipStore> {
    const browserStorage = getBrowserStorage(storage);
    const scope = await storageScope(accountId, contractAddress);
    return new LocalOwnershipStore(browserStorage, `${OWNERSHIP_KEY_PREFIX}:${scope}`);
  }

  get(sequence: bigint): LocalOwnershipRecord | undefined {
    const document = parseOwnershipDocument(this.storage.getItem(this.storageKey));
    return document.records[sequence.toString()];
  }

  remember(record: LocalOwnershipRecord): LocalOwnershipRecord {
    if (!isOwnershipRecord(record)) throw new TypeError("Invalid local ownership record.");

    const document = parseOwnershipDocument(this.storage.getItem(this.storageKey));
    const existing = document.records[record.sequence];
    if (existing) return existing;

    const next: OwnershipDocument = {
      version: 1,
      records: { ...document.records, [record.sequence]: record },
    };
    this.storage.setItem(this.storageKey, JSON.stringify(next));
    return record;
  }
}
