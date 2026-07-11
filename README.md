# VeilPledge

VeilPledge is a privacy-preserving accountability primitive built on
[Midnight](https://midnight.network). A user publishes a public pledge without
publishing an identity or secret. A random 32-byte secret stays in encrypted
local private state and is exposed to the Compact circuit only through a
witness function. The contract publishes a round-specific commitment derived
from that secret. Later, the creator proves knowledge of the same secret in
zero knowledge to mark the pledge complete.

The Level 2 DApp adds a React interface, Lace wallet connection, browser-side
private state, wallet-delegated proving, and Preprod transaction submission to
the Level 1 Compact contract. The product deliberately stays small: one pledge
can be active at a time, so the privacy boundary and state transitions remain
easy to inspect.

## Level 2 DApp overview

The browser can read the public pledge board from the Preprod indexer before a
wallet is connected. A state-changing action then follows this flow:

1. Discover a Lace-compatible Midnight DApp connector with API major version
   4 and request `connect("preprod")`.
2. Verify both the connection status and returned wallet configuration are for
   Preprod.
3. Load the compiled Compact contract and its proving material from the same
   origin as the DApp.
4. Ask Lace for a proving provider, balance the unsealed transaction through
   Lace, and submit the finalized transaction through Lace.
5. Read the confirmed public ledger state and show the transaction result.

Creating a pledge calls `createPledge(goal)` from the frontend. Completing one
calls `completePledge()` and demonstrates the privacy behavior: the public goal
is visible to every visitor, while only the browser profile holding the
matching private witness can produce the ownership proof.

The DApp's **Disconnect** control is intentionally local. Connector API 4.x
does not expose a standard disconnect or revoke method, so the control removes
the in-memory VeilPledge client and subscriptions but does not revoke Lace's
authorization. Use Lace itself to review or revoke an authorized DApp session.

## Privacy claim

**VeilPledge makes the pledge text, board status, sequence, completion count,
and owner commitment public. It never writes the raw owner secret, wallet
signing keys, or private witness to the public ledger.** The
application-generated owner secret is encrypted at rest in account-scoped
local private state and enters the Compact circuit only through
`localSecretKey()`. Proving is delegated through Lace, and the DApp uses
connector methods instead of reading signing keys.

The at-rest encryption protects against casual inspection of the raw IndexedDB
store. Its generated vault password is kept in same-origin browser storage, so
it is not a defense against malicious script running on the DApp origin, a
compromised browser profile, or device access. The shipped Content Security
Policy reduces script and connection scope, but users still need to protect
their browser profile and avoid untrusted builds.

This is a contract-level privacy claim, not an anonymity guarantee for all
metadata. Transaction timing, network activity, the deliberately public pledge
text, and ordinary chain metadata remain observable.

## What the contract does

The public ledger records:

- whether the board is `OPEN` or `ACTIVE`;
- the deliberately disclosed pledge text;
- a sequence number that changes after every completion;
- a domain-separated owner commitment; and
- the aggregate number of completed pledges.

The raw owner secret never enters the public ledger. Creating a pledge stores
`persistentHash("veilpledge:owner:", sequence, secret)`. Completing it requires
a valid ZK proof that the caller's private secret produces the same commitment.
The sequence makes the public commitment different in every round, even when
the same local secret is reused.

## DApp architecture

| Layer | Responsibility |
| --- | --- |
| React UI and controller | Render public state, request wallet connection, and coordinate create/complete states |
| Lace connector adapter | Require connector API 4.x and Preprod, obtain the proving provider, balance transactions, and submit finalized transactions |
| Browser private-state provider | Persist the random owner secret encrypted at rest in a Lace-account-scoped local store without replacing it on reconnect |
| Preprod public-data provider | Query and observe the deployed contract's public ledger through the Preprod indexer |
| Generated Compact binding | Supply `localSecretKey()` as a private witness and invoke `createPledge` or `completePledge` |
| Compact contract | Enforce one active pledge, publish the chosen goal and commitment, and verify ownership in zero knowledge |

## Public state vs private data

| Data | Location or custodian | Visibility |
| --- | --- | --- |
| Pledge text | Midnight ledger | Public by deliberate `disclose()` |
| `OPEN`/`ACTIVE` board status | Midnight ledger | Public |
| Sequence and completion count | Midnight ledger | Public |
| Owner commitment | Midnight ledger | Public domain-separated hash |
| Raw 32-byte owner secret | Encrypted browser private state | Local to the matching Lace account and browser storage |
| `localSecretKey()` witness value | Compact witness context | Private circuit input; never written to the ledger |
| Wallet signing keys | Lace | Never exposed to VeilPledge or the ledger |
| Ownership check | Compact ZK circuit | Verified without revealing the secret or witness |

Compact circuit inputs are private by default. `createPledge` deliberately
discloses the pledge text and derived commitment because both become public
ledger state. `localSecretKey()` returns the local secret to the circuit, but
the secret itself is never disclosed. See the official Midnight guides on
[Compact privacy](https://docs.midnight.network/getting-started/hello-world)
and the
[bulletin-board witness pattern](https://docs.midnight.network/tutorials/bboard/smart-contract).

## Contract lifecycle

1. The contract starts `OPEN`, at sequence `1`, with no pledge.
2. `createPledge(goal)` checks that the board is open, derives a commitment
   from the private secret and current sequence, publishes the goal, and moves
   the board to `ACTIVE`.
3. `completePledge()` checks that a pledge exists and that the caller can prove
   knowledge of the committed secret.
4. Completion clears the goal, increments both sequence and completion count,
   and reopens the board.

## Requirements

- macOS or Linux
- Node.js 22 or newer (`.nvmrc` uses Node 22)
- Compact CLI 0.5.1 and compiler 0.31.1
- a Lace browser wallet exposing Midnight DApp connector API 4.x, switched to
  Preprod and funded for Preprod transactions;
- a working proving provider in Lace. For the current Preprod developer flow,
  configure Lace's proof server as Local (`http://localhost:6300`) and run
  `npm run proof-server:start` before the first create/complete transaction
- a secure browser context with WebCrypto and persistent browser storage
- Docker Desktop with Compose v2 for CLI deployment, the local proof server,
  or the local devnet (the browser DApp delegates proving to Lace)
- the pinned runtime versions in this repository: Midnight.js 4.1.1, connector
  API 4.0.1, ledger 8.1.0, and proof server 8.1.0

Install Compact using the current official command:

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.31.1
compact --version
compact compile --version
```

## Install, compile, and test

```bash
nvm use
npm ci
npm run compile
npm test
npm run typecheck
npm run web:typecheck
```

The compiler writes generated contract code, ZK IR, and proving/verifying keys
to `contracts/managed/veilpledge/`. Generated artifacts are gitignored and must
be recreated from the Compact source. `npm test` runs both the Compact/private
state suite and the web component suite.

The contract/private-state suite has ten tests: seven Compact simulator checks
plus three checks that private-state passwords are strong and validated before
deployment. The contract checks cover:

- deterministic initialization;
- public pledge creation and unchanged local private state;
- rejection of a second active pledge;
- rejection of completion by a different secret;
- successful creator completion;
- rejection when no pledge is active; and
- commitment rotation between rounds.

## Run and build the DApp

Compile the contract first, then start the Vite development server:

```bash
npm run compile
npm run web:dev
```

`web:dev` copies the generated contract module, ZK IR, proving/verifying keys,
and public Preprod deployment metadata into gitignored web build directories.
The local DApp is served at `http://127.0.0.1:4173/`.

Create and preview the same sub-path build used by GitHub Pages:

```bash
VITE_BASE_PATH=/veilpledge/ npm run web:build
npm run web:preview
```

The complete verification sequence is:

```bash
npm run compile
npm run test:contract
npm run typecheck
npm run web:prepare
npm run web:test
npm run web:typecheck
VITE_BASE_PATH=/veilpledge/ npm run web:build
```

## Local deployment

With Docker running:

```bash
npm run setup
npm run test:e2e
npm run cli
```

`npm run setup` starts the bundled local node, indexer, and pinned proof server,
compiles the contract, creates encrypted private state, and deploys it with the
prefunded development wallet.

## Preprod deployment for Level 2

The Level 2 DApp is fixed to Preprod. To create its public deployment record,
run:

```bash
npm run setup -- --network preprod
npm run test:e2e -- --network preprod
```

On first use, setup creates a local Preprod deployment wallet, prints its
address and the [Preprod faucet](https://midnight-tmnight-preprod.nethermind.dev/),
waits for funding, and deploys after the wallet has synchronized. A successful
deployment writes only public evidence - network, contract address,
transaction hash, block height, and deployment time - to
`deployments/preprod.json`. The DApp build reads that record through
`npm run web:prepare`.

The one-time GitHub Actions deployment additionally requires a repository
Actions secret named `MIDNIGHT_WALLET_SEED` containing exactly 64 hexadecimal
characters. Keep that secret stable across reruns so a funded deployment
address remains recoverable; never place the seed in workflow inputs, logs,
artifacts, commits, screenshots, or issue comments.

The deploy command also keeps the wallet seed and encrypted private state in
gitignored local files. **Never commit, publish, paste, or screenshot
`.midnight-state.json`, `.midnight-wallet-state`, or `midnight-level-db`.** The
public `deployments/preprod.json` record must be independently checked with the
Preprod indexer before its values are added to submission evidence.

## Preview deployment

Preview is the intended public target for this Level 1 submission:

```bash
npm run setup -- --network preview
```

On first use the script creates a Preview wallet, prints its address and the
[Preview faucet](https://midnight-tmnight-preview.nethermind.dev/), waits for
funding, and deploys automatically. Verify the public deployment with:

```bash
npm run test:e2e -- --network preview
```

The tracked public record in `deployments/preview.json` makes that verification
work from a clean clone without a wallet seed, private state, signing key, or
proof server. It decodes the indexed ledger and checks lifecycle invariants, so
it remains valid after pledges are created or completed. The owner CLI uses the
gitignored local private state:

```bash
npm run cli -- --network preview
```

The deploy command writes network, contract address, and wallet seed to the
gitignored `.midnight-state.json`. **Never commit or screenshot that file.**

## Level 2 evidence

The fields below are deliberately left pending until a real Preprod deployment,
Pages deployment, and recorded wallet flow have been verified. An expected URL
is not submission proof until CI has deployed it and the live page has been
opened successfully.

| Field | Current evidence |
| --- | --- |
| Public repository | [github.com/himanshu748/veilpledge](https://github.com/himanshu748/veilpledge) |
| Preprod contract address | **Pending - fill from a verified `deployments/preprod.json`** |
| Preprod deployment transaction | **Pending - fill from the indexed deployment record** |
| Preprod deployment block | **Pending - fill from the indexed deployment record** |
| Live DApp | Expected after successful Pages CI: [himanshu748.github.io/veilpledge/](https://himanshu748.github.io/veilpledge/) - **not yet verified here** |
| Successful frontend circuit transaction | **Pending - record a real Preprod create/complete transaction** |
| Demo video | **Pending - record Lace connect plus a successful frontend circuit call** |

## Level 1 Preview deployment evidence

| Field | Value |
| --- | --- |
| Network | Midnight Preview |
| Contract address | `03a38b13de46c09f93621bbbc97ff537bada6f341066750a42de5a60e0985a39` |
| Deployment transaction | `e5495322fad11d200849f5be76d8b475b4019f8331bd4318a5a5a8a9fc996ab2` |
| Block | `1545814` |
| Deployment date | 2026-07-10 14:00:42 UTC |

Submission screenshots:

- [`compile.png`](docs/screenshots/compile.png) — successful Compact compilation;
- [`tests.png`](docs/screenshots/tests.png) — all ten tests passing; and
- [`deployment.png`](docs/screenshots/deployment.png) — public on-chain Preview
  verification binding the contract address to its indexed `ContractDeploy`
  transaction and block. This is verification evidence, not a replayed deploy.

Each PNG is rendered directly from the corresponding literal terminal
transcript in [`docs/evidence/`](docs/evidence/); no output lines are manually
added.

## Level 1 submission checklist

- [x] Compact toolchain installed and version recorded
- [x] Contract compiles and produces circuits/keys
- [x] Passing automated test suite
- [x] Public/private state boundary documented
- [x] Initial product idea documented
- [x] Local setup instructions documented
- [x] At least five meaningful Git commits
- [x] Docker proof server/devnet available
- [x] Contract deployed to Preview or Preprod
- [x] Public contract address added above
- [x] Compile, tests, and on-chain deployment verification screenshots added
- [x] Public GitHub repository connected to Rise In

## Limitations and next steps

- The pledge text is intentionally public.
- Only one pledge can be active in the current contract.
- Any caller can occupy that single public slot. There is no timeout or admin
  recovery circuit, so a caller who loses private state can lock this demo
  deployment in `ACTIVE`; production designs need per-user boards or expiry.
- Losing or clearing the encrypted browser private state prevents the original
  owner from completing an active pledge.
- The in-app disconnect control does not revoke the authorization stored by
  Lace; session management remains a wallet action.
- The contract proves that the original creator invoked completion; it cannot
  prove that a real-world activity actually happened.
- Transaction timing and ordinary chain metadata are outside this contract's
  privacy guarantee.
- The self-only browser Content Security Policy permits JavaScript dynamic
  evaluation because the current Midnight wasm-bindgen runtime requires it;
  this weakens protection against a same-origin script compromise.

A later version can add multiple pledges, deadlines, recovery keys, and
selectively disclosed or encrypted pledge text.

## Project structure

```text
veilpledge/
├── .github/workflows/ci.yml           # Verify and deploy the Pages build
├── .github/workflows/preprod-deploy.yml # One-time remote Preprod deployment
├── contracts/veilpledge.compact       # Compact source
├── deployments/preview.json           # Public Preview deployment record
├── scripts/
│   ├── e2e-check.ts                    # Public deployment verification
│   └── prepare-web-assets.mjs          # Copy generated contract/ZK assets
├── src/
│   ├── private-state.ts               # Local secret and witness
│   ├── compiled-contract.ts           # Generated-contract binding
│   ├── deploy.ts                      # Local/Preview/Preprod deployment
│   └── cli.ts                         # Create, complete, and inspect pledges
├── docs/evidence/                      # Literal command transcripts
├── docs/screenshots/                   # Submission evidence
├── tests/                              # Simulator and privacy tests
├── web/
│   ├── src/controller/                 # DApp state and user-action flow
│   ├── src/lib/                        # Lace, provider, and contract adapters
│   ├── src/components/                 # Responsive interface components
│   └── src/test/                       # Web component tests
└── docker-compose.yml                  # Local node/indexer/proof server
```

A successful Level 2 deployment adds `deployments/preprod.json`; it is omitted
from the tree above until real public values exist.

## Acknowledgements

VeilPledge follows the witness, simulator, and domain-separated commitment
patterns demonstrated by Midnight's official
[`example-bboard`](https://github.com/midnightntwrk/example-bboard). The project
was scaffolded with the official
[`create-mn-app`](https://github.com/midnightntwrk/create-mn-app) contract
template.
