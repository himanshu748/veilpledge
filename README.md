# VeilPledge

VeilPledge is a privacy-preserving accountability primitive built on
[Midnight](https://midnight.network). A user publishes a public pledge without
publishing an identity or secret. A random 32-byte secret stays in encrypted
local private state and is exposed to the Compact circuit only through a
witness function. The contract publishes a round-specific commitment derived
from that secret. Later, the creator proves knowledge of the same secret in
zero knowledge to mark the pledge complete.

This Level 1 implementation deliberately keeps the product small: one pledge
can be active at a time. The goal is to make the privacy boundary, state
transitions, tests, and deployment evidence easy to inspect.

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

## Public state vs private witness

| Data | Location | Visibility |
| --- | --- | --- |
| Pledge text | Ledger | Public by deliberate `disclose()` |
| Open/active state | Ledger | Public |
| Sequence and completion count | Ledger | Public |
| Owner commitment | Ledger | Public domain-separated hash |
| Raw 32-byte owner secret | Encrypted private state | Local only |
| Ownership check | Compact ZK circuit | Verified without revealing the secret |

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
- Docker Desktop with Compose v2 for the local proof server/devnet
- Compact CLI 0.5.1 and compiler 0.31.1
- Preview-compatible runtime: Midnight.js 4.1.1, ledger 8.1.0, and proof
  server 8.1.0 (all pinned in this repository)

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
npm install
npm run compile
npm test
npm run typecheck
```

The compiler writes generated contract code, ZK IR, and proving/verifying keys
to `contracts/managed/veilpledge/`. Generated artifacts are gitignored and must
be recreated from the Compact source.

The suite has ten tests: seven Compact simulator checks plus three checks that
private-state passwords are strong and validated before deployment. The
contract checks cover:

- deterministic initialization;
- public pledge creation and unchanged local private state;
- rejection of a second active pledge;
- rejection of completion by a different secret;
- successful creator completion;
- rejection when no pledge is active; and
- commitment rotation between rounds.

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
Copy only the network and contract address into the evidence section below.

## Deployment evidence

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
- [ ] Public GitHub repository connected to Rise In

## Limitations and next steps

- The pledge text is intentionally public.
- Only one pledge can be active in this Level 1 contract.
- Losing the encrypted local secret prevents completion.
- The contract proves that the original creator invoked completion; it cannot
  prove that a real-world activity actually happened.
- Transaction timing and ordinary chain metadata are outside this contract's
  privacy guarantee.

A later version can add multiple pledges, deadlines, recovery keys, and
selectively disclosed or encrypted pledge text.

## Project structure

```text
veilpledge/
├── contracts/veilpledge.compact      # Compact source
├── deployments/preview.json           # Public Preview deployment record
├── scripts/e2e-check.ts               # Public deployment verification
├── src/
│   ├── private-state.ts               # Local secret and witness
│   ├── compiled-contract.ts           # Generated-contract binding
│   ├── deploy.ts                      # Local/Preview/Preprod deployment
│   └── cli.ts                         # Create, complete, and inspect pledges
├── tests/                              # Simulator and privacy tests
├── docs/evidence/                      # Literal command transcripts
├── docs/screenshots/                   # Submission evidence
└── docker-compose.yml                  # Local node/indexer/proof server
```

## Acknowledgements

VeilPledge follows the witness, simulator, and domain-separated commitment
patterns demonstrated by Midnight's official
[`example-bboard`](https://github.com/midnightntwrk/example-bboard). The project
was scaffolded with the official
[`create-mn-app`](https://github.com/midnightntwrk/create-mn-app) contract
template.
