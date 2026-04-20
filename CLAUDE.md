# Cross-Chain Atomic Swap: Midnight (USDC) <-> Cardano (ADA)

## What This Project Is

A trustless cross-chain atomic swap between **Midnight** (privacy-focused L1) and **Cardano** (Preprod testnet). Alice trades ADA for native USDC; Bob trades native USDC for ADA. Neither party can cheat — escrow is hash-time-locked on both chains, and if either side times out the funds reclaim to the original sender.

The Midnight side has been **split into two contracts**:

- `usdc.compact` — pure USD Coin minter built on Midnight's native unshielded-token primitives (`mintUnshieldedToken` / `receiveUnshielded` / `sendUnshielded`). No internal balance map; coins live in user wallets at the Zswap layer, analogous to ADA in Cardano UTXOs.
- `htlc.compact` — generic, color-parametric hash-time-locked escrow that holds native unshielded coins of any color. Pulls coins in on deposit, releases to receiver on `withdrawWithPreimage` or back to sender on `reclaimAfterExpiry`.

This decoupling mirrors the Cardano design: HTLC is a pure escrow that holds a native asset, never an ERC20-ish ledger embedded in the same contract.

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
│   │   ├── test/
│   │   │   └── sha256-equivalence.test.ts  # Proves Compact persistentHash<Bytes<32>> == Node createHash('sha256')
│   │   └── vendor/openzeppelin/     # Retained for reference; no longer imported by HTLC
│   └── package.json
│
├── htlc-ft-cli/                     # CLI tools for running swaps
│   ├── src/
│   │   ├── execute-swap.ts          # Automated end-to-end swap — the regression harness
│   │   ├── alice-swap.ts            # Alice's two-terminal flow (initiator)
│   │   ├── bob-swap.ts              # Bob's two-terminal flow (responder)
│   │   ├── setup-contract.ts        # Deploys both contracts, mints initial USDC, writes swap-state.json
│   │   ├── mint-usdc.ts             # Mint more native USDC after setup
│   │   ├── smoke-native.ts          # Deposit + reclaim smoke test on Midnight only (no Cardano)
│   │   ├── smoke-cardano-reclaim.ts # Lock + reclaim on Cardano HTLC (post-deadline)
│   │   ├── midnight-watcher.ts      # Polls indexer for deposits + revealedPreimages
│   │   ├── cardano-watcher.ts       # Polls Blockfrost for HTLC UTxOs; filters by receiver PKH + hash
│   │   ├── cardano-htlc.ts          # Cardano off-chain module (Lucid Evolution)
│   │   ├── index.ts                 # Interactive CLI menu (original bboard, retained)
│   │   ├── config.ts
│   │   ├── midnight-wallet-provider.ts
│   │   ├── wallet-utils.ts
│   │   ├── generate-dust.ts
│   │   ├── mint-tnight.ts
│   │   ├── generate-keys.ts
│   │   ├── check-balance.ts
│   │   ├── check-midnight-balance.ts
│   │   └── send-ada.ts
│   ├── address.json                 # Alice/Bob/Charlie addresses (both chains)
│   ├── swap-state.json              # Written by setup-contract: contract addresses + usdcColor
│   ├── pending-swap.json            # Written by alice-swap: hash for bob-swap's watcher filter
│   └── .env                         # BLOCKFROST_API_KEY
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
   Alice also writes HASH to pending-swap.json so Bob can filter.
3. Bob watches Cardano, matches Alice's lock by HASH, deposits native USDC
   on Midnight HTLC (same HASH, ≥10min shorter deadline than Alice's, receiver = Alice).
4. Alice claims USDC on Midnight by calling withdrawWithPreimage(PREIMAGE).
   This reveals PREIMAGE in the HTLC's revealedPreimages map.
5. Bob watches Midnight's revealedPreimages map and reads PREIMAGE.
6. Bob claims ADA on Cardano with PREIMAGE.
   Cardano validator checks sha256(PREIMAGE) == datum.preimageHash.

If either side times out, the original sender reclaims:
  - Alice's ADA on Cardano after her deadline (Reclaim redeemer).
  - Bob's USDC on Midnight after his deadline (reclaimAfterExpiry circuit).
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
mint-tnight     # Mint tNight to wallets
check-balance   # Cardano ADA balance
check-midnight  # Midnight balance
typecheck       # tsc --noEmit
```

All CLI scripts run via: `node --experimental-specifier-resolution=node --loader ts-node/esm src/<script>.ts`.

## Network Configuration

**Midnight (local dev, networkId: 'undeployed'):**
- Node: `http://127.0.0.1:9944` / `ws://127.0.0.1:9944`
- Indexer: `http://127.0.0.1:8088/api/v3/graphql` / `ws://127.0.0.1:8088/api/v3/graphql/ws`
- Proof Server: `http://127.0.0.1:6300`

**Cardano (Preprod testnet):**
- Blockfrost: `https://cardano-preprod.blockfrost.io/api/v0`
- API key in `.env`: `BLOCKFROST_API_KEY=preprodmt96ybDEKiQr93kJbYa8oaziBoQL1sYg`

Preview was dropped earlier due to `PPViewHashesDontMatch` errors from Blockfrost cost-model mismatch; Preprod does not have this problem.

## Wallet Funding

- **Midnight:** ~1T tNight per participant for dust; local dev `additionalFeeOverhead` is 500Q. Use `mint-tnight.ts`.
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
- Auth key: pass `Bytes<32>` (coin public key bytes), checked against `ownPublicKey().bytes` inside the circuit.

### PublicDataProvider
- **NOT a generic type** — use `PublicDataProvider`, never `PublicDataProvider<any>`.
- `queryContractState(contractAddress)` → decode with `ledger(state.data)`.

### Midnight indexer
- GraphQL at `http://127.0.0.1:8088/api/v3/graphql`, WS at `.../graphql/ws`.
- `contractStateObservable()` for subscriptions, `queryContractState()` for polling.

### Watcher pitfall: shared script address + concurrent HTLCs
The Cardano script address is shared across ALL HTLCs (it's purely the compiled validator's script hash). `cardano-watcher.watchForCardanoLock` must filter by (a) receiver PKH, (b) freshness (`datum.deadline > now`), AND (c) specific `hashHex` from the coordinated swap. Without the hash filter, Bob can latch onto the wrong UTXO when concurrent or orphaned locks exist.

Coordination is via `pending-swap.json`: Alice writes the hash after locking; Bob reads it (or takes `--hash` CLI arg / `SWAP_HASH` env var). See `alice-swap.ts` and `bob-swap.ts`.

### Deadline validation (bob-swap.ts)
Before depositing on Midnight, Bob checks that Alice's Cardano deadline is at least `MIN_CARDANO_DEADLINE_WINDOW_SECS` (30min) away and picks a Midnight deadline `SAFETY_BUFFER_SECS` (10min) inside of it. Aborts if the margins cannot be satisfied — this protects Bob from a "lowballed deadline" race.

### Non-interactive flags
Both `alice-swap.ts` and `bob-swap.ts` accept `--yes` or respective `ALICE_ACCEPT_ALL=1` / `BOB_ACCEPT_ALL=1` env vars for unattended runs (two-terminal tests, CI). Alice additionally honours `ALICE_ADA`, `ALICE_USDC`, `ALICE_DEADLINE_MIN`.

## Verification Tests

- `contract/src/test/sha256-equivalence.test.ts` — proves Compact's `persistentHash<Bytes<32>>` ≡ Node's `createHash('sha256')`. This is the load-bearing invariant of the cross-chain lock; if it ever diverged, swaps would silently fail. Run with `cd contract && npm test`.
- `htlc-ft-cli/src/smoke-native.ts` — deposits + reclaims on Midnight only (no Cardano), useful for shaking out the `receiveUnshielded`/`sendUnshielded` path after contract edits.
- `htlc-ft-cli/src/smoke-cardano-reclaim.ts` — locks on Cardano and reclaims past the deadline. Exercises the `Reclaim` redeemer and the validFrom slot-alignment offset.
- `htlc-ft-cli/src/execute-swap.ts` — full end-to-end automated regression. Run any time both chains are online.

## Key Files to Read First

1. `contract/src/htlc.compact` — the escrow
2. `contract/src/usdc.compact` — the token minter
3. `cardano/validators/htlc.ak` — the Cardano side
4. `htlc-ft-cli/src/execute-swap.ts` — the regression harness
5. `htlc-ft-cli/src/alice-swap.ts` / `bob-swap.ts` — two-terminal flows
6. `htlc-ft-cli/src/cardano-watcher.ts` / `midnight-watcher.ts` — watchers
7. `htlc-ft-cli/src/cardano-htlc.ts` — Cardano off-chain module

## Running a Swap

Prereqs: Midnight local dev node up, Cardano Preprod Blockfrost key in `.env`, wallets funded.

### One-shot regression

```bash
cd htlc-ft-cli
npx tsx src/execute-swap.ts
```

### Two-terminal flow

```bash
# Setup (once)
cd htlc-ft-cli
npx tsx src/setup-contract.ts           # writes swap-state.json

# Terminal 1 (Alice locks ADA, waits for Bob's USDC)
npx tsx src/alice-swap.ts               # or --yes for unattended

# Terminal 2 (Bob picks up the hash from pending-swap.json, deposits USDC)
npx tsx src/bob-swap.ts                 # or --yes / --hash <hex>
```

Bob's watcher requires `pending-swap.json` (written by Alice after her lock) OR a `--hash` CLI arg / `SWAP_HASH` env var. Without one, it falls back to "first fresh lock for Bob" which is unsafe when the script address holds concurrent UTXOs from other swaps.
