# Cross-Chain Atomic Swap: Midnight (USDC) <-> Cardano (ADA)

## What This Project Is

A trustless cross-chain atomic swap between **Midnight** (privacy-focused L1) and **Cardano** (Preprod testnet). Alice trades ADA for native USDC; Bob trades native USDC for ADA. Neither party can cheat — escrow is hash-time-locked on both chains, and if either side times out the funds reclaim to the original sender.

The Midnight side has been **split into two contracts**:

- `usdc.compact` — pure USD Coin minter built on Midnight's native unshielded-token primitives (`mintUnshieldedToken` / `receiveUnshielded` / `sendUnshielded`). No internal balance map; coins live in user wallets at the Zswap layer, analogous to ADA in Cardano UTXOs.
- `htlc.compact` — generic, color-parametric hash-time-locked escrow that holds native unshielded coins of any color. Pulls coins in on deposit, releases to receiver on `withdrawWithPreimage` or back to sender on `reclaimAfterExpiry`.

This decoupling mirrors the Cardano design: HTLC is a pure escrow that holds a native asset, never an ERC20-ish ledger embedded in the same contract.

## Current Status (as of 2026-04-21)

**End-to-end swap verified GREEN on preprod.** Two-terminal flow (Alice + Bob) executed successfully:

- Hash: `7f6efe70e52d60e98f0edbf8a59b24ddc4647a8b4c8fff3724ec75338fd65b8d`
- Cardano lock tx: `5313d894ff268adbd3ba0355f5929283592a42182e4f81da6c500fa27bc0b177`
- Cardano claim tx: `7b5d27c1ce2648122c75d62f61a66c7f98a55b0840dbbdeae09b9fb0dd9230f5`
- Alice's `withdrawWithPreimage` succeeded without hitting the `Only designated receiver` assertion (this was the bug that blocked the prior run — see "Known Incidents & Fixes" below).
- Bob's watcher picked up the preimage from Midnight's `revealedPreimages`, claimed ADA on Cardano.
- Funds flowed correctly: Alice `-1 ADA / +1 USDC`, Bob `+1.34903 ADA / -1 USDC` (ADA delta differs because Alice's lock carries min-UTxO overhead).

**What this proves:** the contract split (usdc + htlc), the Compact native-unshielded coin I/O (`receiveUnshielded` / `sendUnshielded`), the `revealedPreimages` reveal-and-read mechanism, the Cardano validFrom slot-alignment fix, and the `pending-swap.json` Alice→Bob coordination all work together.

**What's next:** integrate this flow into a browser frontend. See "Frontend Integration Roadmap" at the bottom.

## Project Layout

```
example-bboard/
├── contract/                        # Midnight smart contracts (Compact language)
│   ├── src/
│   │   ├── htlc.compact             # Generic native-token HTLC escrow (THE main contract)
│   │   ├── usdc.compact             # USDC native unshielded-token minter
│   │   ├── htlc-contract.ts         # TypeScript wrapper for htlc
│   │   ├── usdc-contract.ts         # TypeScript wrapper for usdc
│   │   ├── managed/htlc/            # Compiled HTLC artifacts (prover/verifier keys, ZKIR)
│   │   ├── managed/usdc/            # Compiled USDC artifacts
│   │   ├── managed/bboard/          # (Legacy) compiled artifacts for the original Bulletin Board demo
│   │   ├── bboard.compact           # (Legacy) Bulletin Board contract — retained as UI scaffolding reference
│   │   ├── test/
│   │   │   └── sha256-equivalence.test.ts  # Proves Compact persistentHash<Bytes<32>> == Node createHash('sha256')
│   │   └── vendor/openzeppelin/     # Retained for reference; no longer imported by HTLC
│   └── package.json
│
├── htlc-ft-cli/                     # CLI tools for running swaps — THE working reference implementation
│   ├── src/
│   │   ├── execute-swap.ts          # Automated end-to-end swap (single-process regression harness)
│   │   ├── alice-swap.ts            # Alice's two-terminal flow (initiator)
│   │   ├── bob-swap.ts              # Bob's two-terminal flow (responder)
│   │   ├── reclaim-usdc.ts          # Bob's Midnight USDC reclaim after expiry
│   │   ├── reclaim-ada.ts           # Alice's Cardano ADA reclaim after deadline
│   │   ├── setup-contract.ts        # Deploys both contracts, mints initial USDC, writes swap-state.json
│   │   ├── mint-usdc.ts             # Mint more native USDC after setup
│   │   ├── smoke-native.ts          # Deposit + reclaim smoke test on Midnight only (no Cardano)
│   │   ├── smoke-cardano-reclaim.ts # Lock + reclaim on Cardano HTLC (post-deadline)
│   │   ├── midnight-watcher.ts      # Polls indexer for deposits + revealedPreimages
│   │   ├── cardano-watcher.ts       # Polls Blockfrost for HTLC UTxOs; filters by receiver PKH + hash
│   │   ├── cardano-htlc.ts          # Cardano off-chain module (Lucid Evolution)
│   │   ├── regenerate-midnight-keys.ts  # ⚠ KNOWN BUG: writes Night pubkey into `coinPublicKey` field. See Incidents.
│   │   ├── config.ts                # Network selector: MIDNIGHT_NETWORK=preprod|undeployed
│   │   ├── midnight-wallet-provider.ts  # Seed-based wallet provider (CLI-only). UI needs dapp-connector-api instead.
│   │   ├── wallet-utils.ts
│   │   ├── generate-dust.ts
│   │   ├── mint-tnight.ts
│   │   ├── generate-keys.ts
│   │   ├── check-balance.ts
│   │   ├── check-midnight-balance.ts
│   │   └── send-ada.ts
│   ├── address.json                 # Alice/Bob/Charlie addresses (both chains).
│   │                                # ⚠ midnight.coinPublicKey field is semantically WRONG (Night key, not Zswap key);
│   │                                # alice-swap bypasses it by publishing the runtime key to pending-swap.json.
│   ├── swap-state.json              # Written by setup-contract: contract addresses + usdcColor
│   ├── pending-swap.json            # Written by alice-swap: hash + runtime coinPublicKey for Bob's filter + receiverAuth
│   └── .env                         # BLOCKFROST_API_KEY
│
├── api/                             # (Legacy) Bulletin Board API layer (`BBoardAPI`). Reference for how to structure
│                                    # a frontend-facing API wrapping a deployed contract. Not yet adapted for HTLC.
│
├── bboard-ui/                       # (Legacy) Bulletin Board Vite/React frontend. Reference for:
│                                    #   - Lace wallet integration via @midnight-ntwrk/dapp-connector-api
│                                    #   - ConnectedAPI / InitialAPI flow in BrowserDeployedBoardManager.ts
│                                    #   - FetchZkConfigProvider for browser-side ZK key fetching
│                                    #   - MUI + react-router-dom UX scaffolding
│
├── bboard-cli/                      # (Legacy) Bulletin Board CLI. Superseded by htlc-ft-cli.
│
└── cardano/                         # Cardano validators (Aiken language)
    ├── validators/
    │   ├── htlc.ak                  # HTLC spending validator
    │   └── swap_token.ak            # One-shot minting policy
    ├── lib/htlc/                    # Types and validation logic
    └── plutus.json                  # Compiled Plutus blueprint
```

## How the Atomic Swap Works

```
Alice has ADA on Cardano, wants native USDC on Midnight.
Bob has native USDC on Midnight, wants ADA on Cardano.

1. Alice generates a random 32-byte PREIMAGE and computes HASH = SHA256(PREIMAGE).
2. Alice locks ADA on Cardano HTLC (keyed by HASH, ~2h deadline, receiver = Bob).
   Alice also writes HASH + her runtime coinPublicKey to pending-swap.json
   so Bob can filter his watcher and use the correct receiverAuth.
3. Bob watches Cardano, matches Alice's lock by HASH, deposits native USDC
   on Midnight HTLC (same HASH, ≥10min shorter deadline than Alice's,
   receiverAuth = Alice's runtime coinPublicKey from pending-swap.json).
4. Alice claims USDC on Midnight by calling withdrawWithPreimage(PREIMAGE).
   This reveals PREIMAGE in the HTLC's revealedPreimages map and passes
   the ownPublicKey().bytes == htlcReceiverAuth assertion.
5. Bob watches Midnight's revealedPreimages map and reads PREIMAGE.
6. Bob claims ADA on Cardano with PREIMAGE.
   Cardano validator checks sha256(PREIMAGE) == datum.preimageHash.

If either side times out, the original sender reclaims:
  - Alice's ADA on Cardano after her deadline (Reclaim redeemer) → reclaim-ada.ts.
  - Bob's USDC on Midnight after his deadline (reclaimAfterExpiry circuit) → reclaim-usdc.ts.
```

## The HTLC Contract (Midnight, Generic Escrow)

**File:** `contract/src/htlc.compact`

Pure color-parametric escrow over native unshielded tokens. No token ledger of its own — it pulls/pushes `Uint<128>` coins of an arbitrary `color: Bytes<32>` via the Zswap primitives.

**Circuits:**
- `deposit(color, amount, hash, expiryTime, receiverAuth, receiverPayout, senderPayout)` — pulls `amount` coins of `color` via `receiveUnshielded`, records parties + deadline + color keyed by `hash`.
- `withdrawWithPreimage(preimage)` — receiver-authenticated claim; derives `hash = persistentHash<Bytes<32>>(preimage)`, sends coins to `receiverPayout`, writes `revealedPreimages[hash] = preimage`, marks amount=0.
- `reclaimAfterExpiry(hash)` — sender-authenticated refund after `blockTimeGt(expiry)`.

**Auth vs. payout separation.** Each entry stores two things per party: a `Bytes<32>` auth key (`ZswapCoinPublicKey` bytes, checked against `ownPublicKey().bytes`) and a payout destination (`Either<ContractAddress, UserAddress>`, consumed by `sendUnshielded`). Compact currently has no primitive to derive one from the other inside a circuit, so both must be passed explicitly.

**Ledger state (all `export ledger`, indexer-queryable):**
- `htlcAmounts: Map<Bytes<32>, Uint<128>>` — escrowed amount per hash; `0` is the completed-swap sentinel.
- `htlcExpiries: Map<Bytes<32>, Uint<64>>`
- `htlcColors: Map<Bytes<32>, Bytes<32>>`
- `htlcSenderAuth`, `htlcReceiverAuth: Map<Bytes<32>, Bytes<32>>`
- `htlcSenderPayout`, `htlcReceiverPayout: Map<Bytes<32>, Either<ContractAddress, UserAddress>>`
- `revealedPreimages: Map<Bytes<32>, Bytes<32>>` — populated by `withdrawWithPreimage`, read by Bob's watcher.

Maps have no `delete`, so sentinel values are used.

## The USDC Contract (Native Token Minter)

**File:** `contract/src/usdc.compact`

Minter for native Zswap unshielded coins with a deterministic color. Constructor takes `(tokenName, tokenSymbol, tokenDecimals, domainSep)`. The domainSep + contract address fully determine the color via `mintUnshieldedToken`.

**Circuits:**
- `mint(recipient: Either<ContractAddress, UserAddress>, amount: Uint<64>)` — mints `amount` native coins of this token's color to `recipient`. First call captures `_color`.
- `name() / symbol() / decimals() / color()` — impure metadata reads.

`_color` is `export ledger Bytes<32>` (not sealed) so it can be set on first mint. There is no on-chain balance map — holders' balances live as native unshielded UTXOs in their wallets.

## The Cardano HTLC (Aiken Validator)

**File:** `cardano/validators/htlc.ak` · **Compiled:** `cardano/plutus.json`

PlutusV3 spending validator:
- **Datum:** `{ preimageHash, sender (PKH), receiver (PKH), deadline (POSIX ms) }`
- **Redeemer:** `Withdraw { preimage }` or `Reclaim`
- **Withdraw:** `sha256(preimage) == datum.preimageHash`, `upper_bound < deadline`, signer is receiver
- **Reclaim:** `lower_bound > deadline` (strict), signer is sender

Off-chain uses Lucid Evolution (`cardano-htlc.ts`).

### validFrom slot-alignment pitfall (reclaim path)

On Preprod (1-slot = 1s), `validFrom(posixMs)` floors to the slot's POSIX start = `slotFromUnixTime(posixMs) * 1000ms`. If `posixMs == deadline`, the tx's `lower_bound` becomes exactly `deadline`, and the Aiken check `lower_bound > deadline` is strictly greater-than, so the reclaim fails on-chain. The fix is to offset by one whole slot past the deadline (`+1000ms`). This lives inside `CardanoHTLC.reclaim()`.

## Build & Compile Process

### Compact contracts (Midnight)

```bash
cd contract

# Compile .compact -> managed artifacts (ZKIR + prover/verifier keys)
npm run compact:htlc     # -> src/managed/htlc/
npm run compact:usdc     # -> src/managed/usdc/

# TypeScript build + copy managed/ + copy .compact sources into dist/
npm run build:all
```

The `compact` binary is at `/Users/kaleab/.local/bin/compact`. Do NOT use `npx compact` — it won't find it.

**IMPORTANT:** After ANY `.compact` file change, compile + `build:all`, otherwise CLI scripts will use stale artifacts and silently break.

### NPM scripts

**Contract (`contract/package.json`):**
```
compact:htlc    # compact compile src/htlc.compact ./src/managed/htlc
compact:usdc    # compact compile src/usdc.compact ./src/managed/usdc
build:all       # rm -rf dist && tsc && cp managed + .compact into dist
test            # vitest — includes sha256-equivalence.test.ts
typecheck       # tsc --noEmit
lint            # eslint src
```

**CLI (`htlc-ft-cli/package.json`):**
```
setup           # Deploy both contracts + mint initial USDC to participants
mint-usdc       # Mint more USDC to a participant
swap:alice      # Run Alice's initiator flow
swap:bob        # Run Bob's responder flow
reclaim-ada     # Alice recovers ADA after Cardano deadline
reclaim-usdc    # Bob recovers USDC after Midnight deadline
mint-tnight     # Mint tNight to wallets
check-balance   # Cardano ADA balance
check-midnight  # Midnight balance
typecheck       # tsc --noEmit
```

All CLI scripts run via: `node --experimental-specifier-resolution=node --loader ts-node/esm src/<script>.ts`.

## Network Configuration

The active Midnight network is selected by `MIDNIGHT_NETWORK=preprod|undeployed` (defaults to `undeployed`). See `htlc-ft-cli/src/config.ts`.

**Midnight preprod (MIDNIGHT_NETWORK=preprod):**
- Node: `https://rpc.preprod.midnight.network` / `wss://rpc.preprod.midnight.network`
- Indexer: `https://indexer.preprod.midnight.network/api/v3/graphql` / `wss://...ws`
- Proof Server: `http://127.0.0.1:6300` (**still local** — run the proof server yourself)
- Faucet: `https://faucet.preprod.midnight.network/`

**Midnight local dev (MIDNIGHT_NETWORK=undeployed):**
- Node: `http://127.0.0.1:9944` / `ws://127.0.0.1:9944`
- Indexer: `http://127.0.0.1:8088/api/v3/graphql` / `ws://127.0.0.1:8088/api/v3/graphql/ws`
- Proof Server: `http://127.0.0.1:6300`

**Cardano (Preprod testnet):**
- Blockfrost: `https://cardano-preprod.blockfrost.io/api/v0`
- API key in `.env`: `BLOCKFROST_API_KEY=...`

Preview was dropped earlier due to `PPViewHashesDontMatch` errors from Blockfrost cost-model mismatch; Preprod does not have this problem.

## Wallet Funding

- **Midnight preprod:** faucet tNight to the `preprodAddress` from `address.json`. Dust auto-generates from it via `generateDust`. On preprod, dust sync takes ~15 min per wallet — budget accordingly.
- **Midnight local dev:** ~1T tNight per participant for dust; local dev `additionalFeeOverhead` is 500Q. Use `mint-tnight.ts`.
- **Cardano Preprod:** fund via faucet. Alice needs the ADA she wants to swap plus fees; Bob needs fees only.

## Key Technical Details & Gotchas

### Compact language
- `Opaque<"string">`, `disclose(value)`, `persistentHash<T>(value)`.
- `ownPublicKey()` — caller's `ZswapCoinPublicKey` (`.bytes` is `Bytes<32>`).
- `receiveUnshielded(color, amount)` / `sendUnshielded(color, amount, recipient)` — native coin I/O.
- `mintUnshieldedToken(domainSep, amount, recipient): Bytes<32>` — returns the derived color.
- `blockTimeLt` / `blockTimeLte` / `blockTimeGt` — time comparisons over `Uint<64>` POSIX seconds or ms depending on context.
- Map has no `delete`; use sentinel values (amount=0 = completed).
- `sealed ledger` fields — write-once-in-constructor (`_color` is intentionally NOT sealed, since it's set on first `mint` call).

### Native unshielded coin I/O
`receiveUnshielded` in a circuit causes `midnight-js-contracts` to attach matching coin inputs of `color` from the caller's wallet. `sendUnshielded` creates an unshielded output to the specified recipient. Per-swap state in the ledger maps (amount, color, expiry, parties) is the source of truth for the contract's bookkeeping; the held coins are released against that state via `sendUnshielded`, and a completed swap is marked by `htlcAmounts[hash] = 0`.

### TypeScript wrapper pattern
```typescript
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as CompiledHTLC from "./managed/htlc/contract/index.js";

export const CompiledHTLCContract = CompiledContract.make<HTLCContract>(
  "Htlc",                                        // label derived from filename
  CompiledHTLC.Contract<EmptyPrivateState>,
).pipe(
  // @ts-expect-error: Witnesses<EmptyPrivateState> = {}
  CompiledContract.withWitnesses({}),
  CompiledContract.withCompiledFileAssets("./managed/htlc"),
);
```

### Address encoding
- `Either<ContractAddress, UserAddress>` is a tagged pair — fill the unused branch with zero bytes:
  ```ts
  // User payout:
  { is_left: false, left: { bytes: new Uint8Array(32) }, right: { bytes: userAddrBytes } }
  ```
- Auth key: pass `Bytes<32>` (coin public key bytes), checked against `ownPublicKey().bytes` inside the circuit. **Source this from the live wallet provider at runtime, not from any cached file.** See "coinPublicKey auth mismatch" under Known Incidents.

### PublicDataProvider
- **NOT a generic type** — use `PublicDataProvider`, never `PublicDataProvider<any>`.
- `queryContractState(contractAddress)` → decode with `ledger(state.data)`.

### Midnight indexer
- GraphQL; endpoint depends on `MIDNIGHT_NETWORK` (see Network Configuration).
- `contractStateObservable()` for subscriptions, `queryContractState()` for polling.

### Watcher pitfall: shared script address + concurrent HTLCs
The Cardano script address is shared across ALL HTLCs (it's purely the compiled validator's script hash). `cardano-watcher.watchForCardanoLock` must filter by (a) receiver PKH, (b) freshness (`datum.deadline > now`), AND (c) specific `hashHex` from the coordinated swap. Without the hash filter, Bob can latch onto the wrong UTxO when concurrent or orphaned locks exist.

Coordination is via `pending-swap.json`: Alice writes the hash after locking; Bob reads it (or takes `--hash` CLI arg / `SWAP_HASH` env var). See `alice-swap.ts` and `bob-swap.ts`. **Currently the preprod script address has ~6 stale unspent UTxOs from prior test runs — any no-filter watcher will latch onto one of them, corrupting the swap. Always publish + filter by hash.**

### Deadline validation (bob-swap.ts)
Before depositing on Midnight, Bob checks that Alice's Cardano deadline is at least `MIN_CARDANO_DEADLINE_WINDOW_SECS` (30min) away and picks a Midnight deadline `SAFETY_BUFFER_SECS` (10min) inside of it. Aborts if the margins cannot be satisfied — this protects Bob from a "lowballed deadline" race.

### Non-interactive flags
Both `alice-swap.ts` and `bob-swap.ts` accept `--yes` or respective `ALICE_ACCEPT_ALL=1` / `BOB_ACCEPT_ALL=1` env vars for unattended runs (two-terminal tests, CI). Alice additionally honours `ALICE_ADA`, `ALICE_USDC`, `ALICE_DEADLINE_MIN`.

## Known Incidents & Fixes

### 1. coinPublicKey auth mismatch (2026-04 — RESOLVED)

**Symptom.** Alice's `withdrawWithPreimage` always failed inside the HTLC circuit with the `Only designated receiver can withdraw` assertion.

**Root cause.** Two different public keys were being conflated:
- The runtime's `ownPublicKey().bytes` inside the Compact circuit is derived from the **Zswap shielded** HD role: `ZswapSecretKeys.fromSeed(seeds.shielded).coinPublicKey`. See `htlc-ft-cli/src/midnight-wallet-provider.ts:47`.
- `htlc-ft-cli/src/regenerate-midnight-keys.ts:24` derives keys using `Roles.NightExternal` (unshielded) and writes `createKeystore(...).getPublicKey()` into a field named `coinPublicKey` in `address.json`. That value is the **unshielded Night** pubkey, NOT the Zswap coin public key — but the field name lied.
- Bob's deposit was passing `address.json.alice.midnight.coinPublicKey` (the Night pubkey, e.g. `8520863716...`) as the `receiverAuth` → stored in `htlcReceiverAuth`. When Alice called `withdrawWithPreimage`, her runtime `ownPublicKey().bytes` was the Zswap key (`b432786e9a...`). The two never matched.

**Fix applied.** `alice-swap.ts:172` now captures `walletProvider.getCoinPublicKey()` at runtime and `alice-swap.ts:233` publishes it alongside the hash into `pending-swap.json`. `bob-swap.ts:190-308` reads `pending.aliceCoinPublicKey` and prefers it over `address.json`, emitting a note if the values differ. With this in place the 2026-04-21 swap completed cleanly.

**Cleanup still owed.** `regenerate-midnight-keys.ts` should either (a) rename its output field from `coinPublicKey` to `nightPublicKey`, or (b) additionally derive the true Zswap coin public key via the SDK's Zswap role and write both. Until then, the `address.json.*.midnight.coinPublicKey` field is a landmine for anyone who trusts the name. **Do not add new readers of `address.json.*.midnight.coinPublicKey` without auditing whether they want the Night key or the Zswap key.**

**Learning for frontend:** the UI must derive auth keys from the connected wallet at runtime (e.g. via `dapp-connector-api`'s `ConnectedAPI`), never from a static config. Inline the key-derivation call every time you build an HTLC tx.

### 2. Stale UTxOs at the shared Cardano script address (ongoing)

The preprod HTLC script address `addr_test1wqnjaplx5fswjr0ja7l2uuv890058f5qkak6cmdpqx8fn3q5v798e` accumulates stale UTxOs from every prior failed swap (observed: 6 unspent at time of writing). A watcher that matches on receiver PKH only can latch onto an unrelated UTxO. Always coordinate by hash (`pending-swap.json` or `--hash` CLI arg). Cleanup: each of those UTxOs is eventually reclaimable by its original sender via `reclaim-ada.ts` once its deadline passes.

### 3. pending-swap.json coordination timing

`bob-swap.ts` reads `pending-swap.json` only AFTER its wallet is built (~15 min preprod dust sync). If Bob is launched BEFORE Alice has written the file, his watcher falls back to "no hash filter" → unsafe (see Incident #2). The safe sequence is:
1. Launch Alice first. Wait for her `Published hash to pending-swap.json` log line.
2. Then launch Bob.

A frontend that owns both roles in one session doesn't have this race — it can push the hash directly into the Bob-role state machine after Alice signs.

## Verification Tests

- `contract/src/test/sha256-equivalence.test.ts` — proves Compact's `persistentHash<Bytes<32>>` ≡ Node's `createHash('sha256')`. This is the load-bearing invariant of the cross-chain lock; if it ever diverged, swaps would silently fail. Run with `cd contract && npm test`.
- `htlc-ft-cli/src/smoke-native.ts` — deposits + reclaims on Midnight only (no Cardano), useful for shaking out the `receiveUnshielded`/`sendUnshielded` path after contract edits.
- `htlc-ft-cli/src/smoke-cardano-reclaim.ts` — locks on Cardano and reclaims past the deadline. Exercises the `Reclaim` redeemer and the validFrom slot-alignment offset.
- `htlc-ft-cli/src/execute-swap.ts` — single-process end-to-end automated regression.
- **Two-terminal flow on preprod** — `alice-swap.ts` + `bob-swap.ts` with `MIDNIGHT_NETWORK=preprod`. Green as of 2026-04-21.

## Key Files to Read First

1. `contract/src/htlc.compact` — the escrow
2. `contract/src/usdc.compact` — the token minter
3. `cardano/validators/htlc.ak` — the Cardano side
4. `htlc-ft-cli/src/execute-swap.ts` — the regression harness (single-process)
5. `htlc-ft-cli/src/alice-swap.ts` / `bob-swap.ts` — two-terminal flows (the reference for UI state machines)
6. `htlc-ft-cli/src/cardano-watcher.ts` / `midnight-watcher.ts` — watchers
7. `htlc-ft-cli/src/cardano-htlc.ts` — Cardano off-chain module
8. `htlc-ft-cli/src/midnight-wallet-provider.ts` — **note:** this is the CLI seed-based provider. The browser must use `@midnight-ntwrk/dapp-connector-api` instead (see `bboard-ui/src/contexts/BrowserDeployedBoardManager.ts` for the pattern).

## Running a Swap

Prereqs: Cardano Preprod Blockfrost key in `.env`, wallets funded, local proof server up at `127.0.0.1:6300`, Midnight preprod endpoints reachable (or local dev node up if `MIDNIGHT_NETWORK=undeployed`).

### One-shot regression (single process, local dev)

```bash
cd htlc-ft-cli
npx tsx src/execute-swap.ts
```

### Two-terminal flow on preprod (the verified path)

```bash
cd htlc-ft-cli

# Setup (once — deploys both contracts to preprod, mints USDC)
MIDNIGHT_NETWORK=preprod npx tsx src/setup-contract.ts

# Terminal 1 — Alice (runs first, writes pending-swap.json after Cardano lock)
MIDNIGHT_NETWORK=preprod ALICE_ACCEPT_ALL=1 ALICE_ADA=1 ALICE_USDC=1 ALICE_DEADLINE_MIN=120 \
  npx tsx src/alice-swap.ts

# Terminal 2 — Bob (only after Alice's "Published hash to pending-swap.json")
MIDNIGHT_NETWORK=preprod BOB_ACCEPT_ALL=1 \
  npx tsx src/bob-swap.ts
```

### Recovery

```bash
# Bob recovers trapped USDC after his Midnight deadline:
MIDNIGHT_NETWORK=preprod npx tsx src/reclaim-usdc.ts          # uses pending-swap.json
MIDNIGHT_NETWORK=preprod npx tsx src/reclaim-usdc.ts --hash <hex>

# Alice recovers ADA after her Cardano deadline:
npx tsx src/reclaim-ada.ts                                    # uses pending-swap.json
npx tsx src/reclaim-ada.ts --hash <hex>
```

Bob's watcher requires `pending-swap.json` (written by Alice after her lock) OR a `--hash` CLI arg / `SWAP_HASH` env var. Without one, it falls back to "first fresh lock for Bob" which is unsafe when the script address holds concurrent UTXOs from other swaps.

---

## Frontend Integration Roadmap

The CLI flow is the behavioural specification. The frontend needs to reproduce the same state machines — Alice-role and Bob-role — inside a browser, driven by user clicks and by a Midnight wallet connector (Lace) plus a Cardano wallet connector (Eternl / Nami / Lace-Cardano). The legacy Bulletin Board UI at `bboard-ui/` provides the Midnight half of the plumbing as a template.

### What to reuse from the legacy bboard stack

| Artefact | Purpose | Re-use strategy |
|---|---|---|
| `bboard-ui/src/contexts/BrowserDeployedBoardManager.ts` | Browser wallet bootstrap, `ConnectedAPI` from `@midnight-ntwrk/dapp-connector-api`, semver handshake, `FetchZkConfigProvider`, `httpClientProofProvider`, `indexerPublicDataProvider` | Copy the top of the file (wallet connect + provider wiring) verbatim; swap the contract-specific bits for HTLC + USDC. This is the hardest-to-rederive code; take it. |
| `bboard-ui/src/contexts/DeployedBoardContext.tsx` + `hooks/useDeployedBoardContext.ts` | React context pattern for deployed contracts | Mirror the shape: one context per role (or one combined swap context), observable state, subscribe from components. |
| `bboard-ui/src/App.tsx`, `main.tsx`, `config/theme.ts`, `components/Layout/` | MUI + react-router-dom scaffolding | Keep wholesale; replace routes + components. |
| `api/src/index.ts` — `BBoardAPI` | Wraps a `findDeployedContract` + exposes `state$: Observable<...>` + action methods | Mirror shape for `HtlcAPI` and `UsdcAPI`; each exposes `state$` (decoded `htlcLedger` / `usdcLedger`) + action methods (`deposit`, `withdrawWithPreimage`, `reclaimAfterExpiry`, `mint`). |
| `api/src/common-types.ts` | Branded private-state keys, `PrivateStates` schema | Replace bboard types with `HTLCPrivateStateId` + `EmptyPrivateState` (already defined in `contract/src/htlc-contract.ts`). |

### What needs to change vs. the CLI

| CLI concern | Frontend replacement |
|---|---|
| `MidnightWalletProvider` (seed-based, `FluentWalletBuilder.withSeed`) | `ConnectedAPI` from `@midnight-ntwrk/dapp-connector-api` — user connects Lace, you get a `walletProvider` + `midnightProvider` + `zswapCoinPublicKey` without ever touching a seed. |
| `generateDust(logger, seed, ...)` | Dust is managed by Lace — no action needed. Drop the call. |
| `waitForUnshieldedFunds` sync-loop | Lace reports balances; surface them in the UI, don't spin. |
| `NodeZkConfigProvider` | `FetchZkConfigProvider` — fetches ZK keys from the webserver at `/keys` and `/zkir` (see `bboard-ui` build script which copies `contract/src/managed/{bboard}/keys` + `zkir` into `dist/`). Do the same for `htlc` + `usdc`. |
| `pending-swap.json` file coordination | Not needed in a single-user UI that drives both roles. In a multi-user UI, hash + Alice's coinPublicKey flow over a backchannel (URL param, relay server, QR code). |
| `alice-swap.ts` / `bob-swap.ts` CLI prompts | React form + state-machine component per role, identical logic otherwise. |
| `address.json` seeds / mnemonics | User-provided wallets. Still need a Cardano wallet connector — Lucid Evolution has a `selectWallet.fromAPI(cardanoWalletApi)` that wraps CIP-30 providers (Eternl, Nami, Lace-Cardano); swap it in for `selectWalletFromSeed`. |
| `BLOCKFROST_API_KEY` in `.env` | Browser-safe alternative: proxy Blockfrost through a small backend, or ship a rate-limited public key (fine for a demo on preprod). **Never embed a production key in client bundles.** |

### Suggested build path for the UI

1. **Scaffold.** `cp -r bboard-ui htlc-ui && cd htlc-ui`. Rename package. Point `tsconfig`/`vite.config` at `../contract/src/managed/{htlc,usdc}` instead of `{bboard}`. Copy the `keys/` + `zkir/` copy step in the `build` script for both contracts.
2. **Wallet wire-up.** Adapt `BrowserDeployedBoardManager.ts` → `BrowserHtlcManager.ts`. Keep the semver check, the `ConnectedAPI` acquisition, the provider bundle. Expose `aliceCoinPublicKey = connectedAPI.zswapCoinPublicKey` — that's the fix for Incident #1 baked into the UI from day one.
3. **Contract API.** Write `api/src/htlc.ts` and `api/src/usdc.ts` mirroring `BBoardAPI`: each wraps a `FoundContract`, exposes `state$`, exposes `deposit / withdrawWithPreimage / reclaimAfterExpiry / mint` methods. Port the read+decode helpers from `midnight-watcher.ts` (`watchForHTLCDeposit`, `watchForPreimageReveal`) into `state$` observables.
4. **Cardano wallet.** Add a `CardanoHTLC.withCIP30(walletApi)` factory in `htlc-ft-cli/src/cardano-htlc.ts` (or a UI-side wrapper) that uses Lucid Evolution's `lucid.selectWallet.fromAPI(walletApi)`. Behavior is identical to `selectWalletFromSeed`; just a different key source.
5. **Role components.** One React route/component per role:
   - `<AliceSwap/>` — form for ADA amount / deadline; click **Lock ADA** → Cardano sign; shows "waiting for Bob"; click **Claim USDC** (enabled when indexer reports the matching deposit) → Midnight sign.
   - `<BobSwap/>` — form for USDC amount; auto-fills hash + Alice coinPublicKey from URL param or clipboard; click **Deposit USDC** → Midnight sign; shows "waiting for Alice to reveal"; click **Claim ADA** (enabled when preimage appears in `revealedPreimages`) → Cardano sign.
   - `<Reclaim/>` — two-button panel: Alice reclaim ADA (post-deadline), Bob reclaim USDC (post-deadline).
6. **Observables.** Use RxJS (already in `bboard-ui` deps) to drive enable/disable state. Key observables:
   - `htlcLedger$` — poll `queryContractState` every ~5s (or subscribe to `contractStateObservable()`).
   - `cardanoLocks$` — poll Blockfrost for UTxOs at the script address, filtered by hash.
7. **Safety gates.** Port the `MIN_CARDANO_DEADLINE_WINDOW_SECS` / `SAFETY_BUFFER_SECS` checks from `bob-swap.ts:240-275` straight into the UI — surface them as inline validation on the Bob form.

### Open questions for the UI Claude session

1. **Hash coordination.** If the UI assumes one user operates both roles (testing), do we still need a backchannel? If it's two users, what's the UX — URL param? QR code? A lightweight websocket relay?
2. **Cardano wallet flavour.** Lace-Cardano, Eternl, Nami — pick one and test its CIP-30 compatibility with Lucid Evolution first.
3. **ZK key hosting.** The `dist/keys` + `dist/zkir` copies assume same-origin hosting. If deployed to Vercel/Netlify, confirm CORS + Cache-Control headers for the blobs (they're ~MB each).
4. **Proof server.** `bboard-ui` probably uses a hosted proof server on preprod; confirm the URL the connected wallet exposes (it should ride along with `ConnectedAPI`) and whether the UI has to configure it.
5. **Dust UX.** On preprod, dust sync takes ~15 min after a first Night faucet. Lace handles this automatically, but show a "syncing dust" state so users don't think the app hung.
