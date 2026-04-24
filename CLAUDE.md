# Midswap — Cross-Chain Atomic Swap (Midnight ⇄ Cardano)

> **Who this is for.** A frontend-designer Claude session inheriting **Midswap**, a
> working bidirectional atomic-swap dApp. Protocol, contracts, wallet bootstrap,
> reducers, observables, orchestrator, and preimage-relay paths are DONE and VERIFIED
> on preprod. Don't rewrite them. Read §7 (architecture) and §13 (what's left), then polish.
>
> Midswap is Uniswap-inspired: unified maker/taker model (no Alice/Bob language),
> Cardano-blue on Midnight-dark, supports USDM⇄USDC in both directions (USDM is a permissionless Cardano stablecoin minted by `usdm.ak`; both sides of the swap are 1:1-peggable dollar stablecoins, so no price feed is needed).

---

## 1. What this is

Trustless atomic swap between **Midnight** (privacy L1) and **Cardano Preprod**.
Two flow directions, both verified end-to-end:

- **`usdm-usdc` (forward)** — maker locks USDM on Cardano first → taker deposits USDC on
  Midnight → maker claims USDC (preimage reveals on Midnight) → taker claims USDM.
- **`usdc-usdm` (reverse)** — maker deposits USDC on Midnight first → taker locks USDM
  on Cardano → maker claims USDM (preimage reveals via Cardano tx redeemer) → taker
  reads preimage from Blockfrost/orchestrator and claims USDC.

Both flows are mirror images using the same contracts. Only the client-side
ordering and preimage-relay path differ.

**Four artefacts:**
- `usdc.compact` — USDC minter over Midnight native unshielded tokens
  (`mintUnshieldedToken` / `receiveUnshielded` / `sendUnshielded`). Coins live
  as Zswap UTXOs in user wallets; no internal balance ledger.
- `htlc.compact` — generic color-parametric hash-time-locked escrow.
- `cardano/validators/htlc.ak` — Aiken → PlutusV3 HTLC, driven off-chain via Lucid Evolution.
- `cardano/validators/usdm.ak` — Aiken → PlutusV3 USDM minting policy, always-true
  (permissionless, mirroring USDC's `mint()`). PolicyId
  `def68337867cb4f1f95b6b811fedbfcdd7780d10a95cc072077088ea`, asset name `USDM`
  (hex `5553444d`). `/mint-usdm` in the UI + `mintUsdm()` in
  `htlc-ui/src/api/cardano-usdm.ts` and `htlc-ft-cli/src/cardano-htlc.ts`.

## 2. Current status

**Verified on preprod:**
- Forward two-browser swap: maker locks USDM in Eternl → URL → taker deposits USDC in
  Lace → maker claims → taker claims. Funds move on both chains.
- Reverse two-browser swap: maker deposits USDC first bound to taker's Midnight keys
  (paste bundle) → URL → taker locks USDM bound to maker's PKH → maker claims USDM
  (preimage in redeemer) → taker reads preimage via Blockfrost + orchestrator fast-path
  → taker claims USDC.
- CLI regression: `npx tsx htlc-ft-cli/src/execute-swap.ts` (forward only; CLI not extended to reverse).

**What the verification proves:** the contract split is correct for both directions;
state machines are sound; orchestrator-relay + Blockfrost redeemer fallback delivers
preimage reliably; native unshielded I/O works in both orderings; bech32m → Bytes<32>
decoding (Landmine #1) holds in both directions.

## 3. Repo layout

```
example-bboard/
├── CLAUDE.md                    ← you are here
├── contract.md                  ← proposed HTLC simplification (drop-auth, not implemented)
├── credit.md                    ← Uniswap-interface design credit
├── contract/src/
│   ├── htlc.compact / usdc.compact
│   ├── {htlc,usdc}-contract.ts
│   └── managed/{htlc,usdc}/     ← compiled: keys/, zkir/, contract/index.d.ts
├── cardano/
│   ├── validators/htlc.ak
│   ├── validators/usdm.ak        ← permissionless USDM minting policy
│   └── plutus.json              ← compiled blueprint (copied into htlc-ui/public)
├── htlc-ft-cli/src/             ← reference CLI (behavioural spec, forward-only)
│   ├── execute-swap.ts          ← single-process regression
│   ├── alice-swap.ts / bob-swap.ts / reclaim-{usdm,usdc}.ts
│   ├── setup-contract.ts        ← deploys USDC on Midnight + seed-mints USDM on Cardano
│   ├── mint-usdc.ts
│   └── {midnight,cardano}-watcher.ts / cardano-htlc.ts / config.ts
├── htlc-ui/                     ← THE frontend = Midswap
│   ├── public/{keys,zkir}/, plutus.json   (populated by predev)
│   ├── src/
│   │   ├── main.tsx / App.tsx / globals.ts / swap-state.json
│   │   ├── in-memory-private-state-provider.ts
│   │   ├── config/{theme,limits}.ts
│   │   ├── api/
│   │   │   ├── common-types.ts / key-encoding.ts
│   │   │   ├── htlc-api.ts / usdc-api.ts
│   │   │   ├── cardano-htlc-browser.ts    (+ findClaimPreimage)
│   │   │   ├── cardano-usdm.ts            (loadUsdmPolicy / mintUsdm / getUsdmBalance)
│   │   │   ├── midnight-watcher.ts / cardano-watcher.ts
│   │   │   └── orchestrator-client.ts     (direction-aware)
│   │   ├── contexts/{BrowserHtlcManager,SwapContext,ToastContext}.tsx
│   │   ├── hooks/{useSwapContext,useToast}.ts
│   │   └── components/
│   │       ├── Layout/{MainLayout,Header,Logo}.tsx
│   │       ├── swap/
│   │       │   ├── SwapCard.tsx                ← centrepiece UI
│   │       │   ├── SwapProgressModal.tsx       ← stepper modal
│   │       │   ├── SettingsDialog.tsx / TokenRow.tsx / TokenBadge.tsx
│   │       │   ├── tokens.ts / keyBundle.ts
│   │       │   └── use{Maker,Taker,ReverseMaker,ReverseTaker}Flow.ts   ← reducers
│   │       ├── Home / Browse / Activity / Reclaim / MintUsdc / MintUsdm / HowTo .tsx
│   │       ├── WalletGate / WalletMenu / ShareUrlCard / SwapStatusChip .tsx
│   │       ├── AsyncButton / RecoveryBanner .tsx
│   │       └── index.ts
│   ├── .env.preprod / index.html (Inter + JetBrains Mono) / package.json / vite.config.ts
└── htlc-orchestrator/src/       ← advisory backend, bidirectional
    ├── server.ts / db.ts (additive migrations) / schema.sql / types.ts
    ├── routes/swaps.ts          (direction-branched validation)
    ├── midnight-watcher.ts / cardano-watcher.ts (direction-aware + preimage extraction)
    └── stuck-alerter.ts
```

Legacy kept for reference (DO NOT delete): `api/` (old BBoard template that
HtlcAPI/UsdcAPI copied from).

**Deleted this session** — don't restore: `AliceSwap.tsx`, `BobSwap.tsx`, `Landing.tsx`,
`Dashboard.tsx`, `WalletConnect.tsx`. Their logic lives in the four `use*Flow.ts` hooks
(reducers), `Home.tsx` + `Activity.tsx`, and `WalletMenu.tsx` + `WalletGate.tsx`.

## 4. Contracts

### HTLC (`contract/src/htlc.compact`)

```typescript
deposit(args): []                      // pulls coins via receiveUnshielded, records record
withdrawWithPreimage(arg): []          // ownPublicKey.bytes must == receiverAuth; persists
                                       //   preimage in revealedPreimages[hash]; amount → 0
reclaimAfterExpiry(arg): []            // ownPublicKey.bytes must == senderAuth
```

Ledger (all `export ledger`, indexer-queryable):

```typescript
htlcAmounts:        Map<Bytes<32>, Uint<128>>  // 0 = completed sentinel
htlcExpiries:       Map<Bytes<32>, Uint<64>>   // seconds since epoch
htlcColors:         Map<Bytes<32>, Bytes<32>>
htlcSenderAuth:     Map<Bytes<32>, Bytes<32>>  // ZswapCoinPublicKey.bytes
htlcReceiverAuth:   Map<Bytes<32>, Bytes<32>>
htlcSenderPayout:   Map<Bytes<32>, Either<ContractAddress, UserAddress>>
htlcReceiverPayout: Map<Bytes<32>, Either<ContractAddress, UserAddress>>
revealedPreimages:  Map<Bytes<32>, Bytes<32>>  // populated by withdrawWithPreimage
```

Compact maps have no delete; `amount=0` = completed. Auth (who-can-call) and
payout (where-coins-go) are separate because Compact can't derive one from the
other inside a circuit.

**Proposed simplification** in `contract.md`: drop `htlcSenderAuth`/`htlcReceiverAuth`,
keep only payouts. Reduces reverse-maker's counterparty input from two keys to one.
Trade-off: mempool-front-run griefing that burns gas but can't steal funds. Not implemented.

### USDC (`contract/src/usdc.compact`)

Circuits: `mint`, `name`, `symbol`, `decimals`, `color`. First `mint()` captures `_color`;
subsequent mints produce coins of the same color. **No access control on `mint()`** —
fine for preprod demo, production needs gating.

### USDM (`cardano/validators/usdm.ak`, PlutusV3)

Always-true minting policy (`mint(_,_,_) { True }`) — mirror of `usdc.compact`'s
permissionless `mint()`. Deterministic policyId
`def68337867cb4f1f95b6b811fedbfcdd7780d10a95cc072077088ea`; asset name `USDM`
(ASCII hex `5553444d`). Unit = `policyId + assetName` (the Cardano asset key
used in `utxo.assets[unit]`). 1 USDM = 1 integer unit (no decimals, mirroring
USDC). The HTLC lock output carries `{ lovelace: ~2 ADA min-UTxO, [usdmUnit]: qty }`;
both move to the spender on claim or reclaim. Locking tx is built via
`htlc-ui/src/api/cardano-usdm.ts::mintUsdm()` (browser, CIP-30) and
`htlc-ft-cli/src/cardano-htlc.ts::mintUsdm()` (CLI, seed). **No access control** —
demo affordance exposed as `/mint-usdm` in the UI; production needs gating.

### Cardano HTLC (`cardano/validators/htlc.ak`, PlutusV3)

- **Datum:** `{ preimageHash, sender(PKH), receiver(PKH), deadline(POSIX ms) }`
- **Redeemer:** `Withdraw{preimage}` | `Reclaim`
- **Withdraw:** `sha256(preimage)==datum.preimageHash` AND `upper_bound < deadline` AND signer=receiver
- **Reclaim:** `lower_bound > deadline` AND signer=sender

**Slot-alignment fix (reclaim):** On Preprod (1 slot = 1s), `validFrom(posixMs)` floors
to slot POSIX start. If `posixMs == deadline`, `lower_bound == deadline` and `>` fails.
Fix: `+1000ms` offset before `validFrom`. Preserved in CLI and browser drivers — leave alone.

**Claim validity bounds (updated this session):** `validTo = deadline - 30_000ms` (was 60s —
too eager for reverse flow's 2h deadline). Pre-flight throws if the window collapsed.
`findHTLCUtxo` retries up to 40s to tolerate Blockfrost's 20-30s UTxO-index lag after taker's lock.

## 5. Protocol

### Forward (`usdm-usdc`)

```
1. Maker: PREIMAGE = random32, HASH = SHA256(PREIMAGE)
2. Maker: lock USDM on Cardano { hash, sender=maker_pkh, receiver=taker_pkh, deadline=now+~4h } — UTxO carries USDM + ~2 ADA min-UTxO; min-ADA is refunded at claim/reclaim alongside USDM
3. Maker: share offer URL / POST to orchestrator
4. Taker: watch Cardano, find lock by hash+own PKH, deposit USDC on Midnight
          deposit(color=usdc, amt, hash, expiry=now+~2h,
                  receiverAuth=maker_cpk, receiverPayout=maker_unshielded,
                  senderPayout=taker_unshielded)
5. Maker: withdrawWithPreimage(PREIMAGE) on Midnight  → preimage in revealedPreimages[hash]
6. Taker: read PREIMAGE from Midnight's revealedPreimages[hash]
7. Taker: claim USDM on Cardano with PREIMAGE as redeemer
```

### Reverse (`usdc-usdm`)

```
1. Maker: PREIMAGE = random32, HASH = SHA256(PREIMAGE)
2. Maker: obtain TAKER's Midnight keys via paste bundle `cpk:unshielded` (from taker's WalletMenu)
3. Maker: deposit USDC on Midnight
          deposit(color=usdc, amt, hash, expiry=now+~4h,
                  receiverAuth=taker_cpk, receiverPayout=taker_unshielded,
                  senderPayout=maker_unshielded)
4. Maker: share URL (direction=usdc-usdm, includes maker's own PKH)
5. Taker: watch Midnight for deposit bound to own cpk, then lock USDM on Cardano
          { hash, sender=taker_pkh, receiver=maker_pkh, deadline=now+~2h }
6. Maker: claim USDM on Cardano with Withdraw{preimage} — preimage commits to tx redeemer
          (no Midnight side-effect)
7. Taker: read preimage from Cardano spend redeemer (Blockfrost /txs/{hash}/redeemers +
          /scripts/datum/{hash}/cbor) OR from orchestrator's midnightPreimage (fast-path,
          PATCHed by maker at claim time)
8. Taker: withdrawWithPreimage(PREIMAGE) on Midnight
```

In both flows, the second party's deadline is tighter and nested inside the first
party's (safety buffer default 5 min). Preimage always becomes public on whichever chain
the maker claims on; taker reads back from there. **Chain state remains authoritative
in both directions** — orchestrator is a fast-path view + preimage relay, never source of truth.

## 6. Browser architecture (`htlc-ui/`)

### Bootstrap (`main.tsx`)

```
<CssBaseline />
<ThemeProvider theme={theme}>            ← Cardano-blue on Midnight-dark
  <ToastProvider>
    <SwapProvider logger={logger}>
      <App />
```

### Routes (`App.tsx`)

| Path          | Component  | Purpose                                          |
|---------------|------------|--------------------------------------------------|
| `/` or `/swap`| `Home`     | Hero + SwapCard + feature tiles. URL → taker mode. |
| `/browse`     | `Browse`   | Open offers (both directions).                   |
| `/activity`   | `Activity` | All swaps, direction column, tx deep-links.      |
| `/reclaim`    | `Reclaim`  | List-driven refund, direction-aware.             |
| `/mint`       | `MintUsdc` | Self-serve USDC mint (demo).                     |
| `/how`        | `HowTo`    | Onboarding walkthrough.                          |
| legacy        | redirect   | `/alice`, `/bob`, `/dashboard`, `/mint-usdc`, `/how-to` → current |

### `SwapCard.tsx` — the heart of the UI

One 480px rounded card, Uniswap-style:
- Header: "Swap" + direction subtitle ("USDM→USDC offer" / "Take USDM→USDC offer" / ...) + settings gear.
- Pay row + flip button (absolute, `translate(-50%, -50%)`) + Receive row.
- Direction-aware counterparty inputs:
  - `maker, usdm-usdc`: one field — "Counterparty Cardano address or PKH".
  - `maker, usdc-usdm`: two fields — "Midnight shielded coin key" + "Midnight unshielded address".
    Plus a **"Paste bundle"** button; pasting a `cpk:unshielded` bundle into either
    field auto-splits.
  - `taker, *`: offer-summary card (hash + deadline), no input.
- Primary CTA (full-width pill) — label adapts: "Connect Midnight + Cardano" / "Enter amount" /
  "Enter counterparty..." / "Review & lock N USDM" / "Review & deposit N USDC" / "View progress".
- Footer: "Need USDC? Mint on Midnight · How it works".

**Flip button:** in maker mode toggles direction (blocks with toast if flow in flight);
in taker mode clears URL and returns to maker (usdm-usdc default).

### `SwapProgressModal.tsx`

Opens on transition out of `idle`. Vertical stepper, four phases per flow. Phase
copy built by `buildForwardMakerPhases` / `buildForwardTakerPhases` /
`buildReverseMakerPhases` / `buildReverseTakerPhases`. Each phase: status
(pending/active/done/error), subtitle, optional action (ShareUrlCard at share step;
AsyncButton for claims).

**Key UX:** `modalOpen` is keyed off `activeState.kind` so "Hide" persists until the
next meaningful state change — users can dismiss and inspect the card underneath.

### Provider chain

**`BrowserHtlcManager.ts`** — hardest-to-rederive code:
1. Polls `window.midnight?.[key]` every 100ms until a Lace-compatible API appears
   (semver `COMPATIBLE_CONNECTOR_API_VERSION = '4.x'`).
2. `initialAPI.enable()` → `connectedAPI`.
3. Fetches `getConfiguration()`, `getShieldedAddresses()`, `getUnshieldedAddress()`.
4. **Decodes bech32m → Bytes<32>** via `src/api/key-encoding.ts` (Landmine #1).
5. Builds `HTLCProviders` + `USDCProviders`, sharing
   `publicDataProvider`/`walletProvider`/`midnightProvider`/`proofProvider`; each has its
   own `inMemoryPrivateStateProvider`.
6. Returns `SwapBootstrap` with raw bytes + hex + bech32m for both keys.

**`SwapContext.tsx`** — idempotent connect for Midnight (Lace) and Cardano (any CIP-30,
prefers Eternl). Separate inflight promises prevent double-connect races.

**`HtlcAPI` / `UsdcAPI`** — mirror the old BBoardAPI pattern: private ctor, `state$`
observable (via `publicDataProvider.contractStateObservable`), action methods return
`FinalizedTxData` (tx hashes), `static async join(...)`.

### Watchers (`src/api/`, all accept `AbortSignal`)

- `watchForHTLCDeposit(pub, addr, hashBytes, pollMs=5000)` → `{amount, expiry, color, senderAuth, receiverAuth}` when `htlcAmounts[hash] > 0n`.
- `watchForPreimageReveal(pub, addr, hashBytes, pollMs=5000)` → `Uint8Array` preimage.
- `watchForCardanoLock(cardanoHtlc, receiverPkh?, pollMs=10_000, hashHex?, signal?)` → lock info.
  **MUST filter by `(receiverPkh, hashHex, deadline > now)`** — see Landmine #2.
- `waitForCardanoHTLCConsumed(...)` — confirms claim/reclaim landed.

### Direction-aware hooks (`src/components/swap/`)

- `useMakerFlow` — forward maker (extracted 1:1 from old AliceSwap). Auto-transitions
  `locked → waiting-deposit` (no manual click gate; the modal makes the share URL prominent).
  Preserves localStorage preimage persistence at `htlc-ui:alice-pending-swap:<hash>`.
- `useTakerFlow` — forward taker (1:1 from old BobSwap). Safety windows preserved.
- `useReverseMakerFlow` — reverse maker; mirror for USDC-first. Its own localStorage key
  `htlc-ui:reverse-maker-pending-swap:<hash>`.
- `useReverseTakerFlow` — reverse taker; mirror of useTakerFlow.

All four write to the orchestrator (`createSwap` at initial lock, `patchSwap` on
every transition) AND poll it for fast-path signals (preimage, counterparty lock). Each
falls back to the chain-authoritative indexer (Midnight indexer, Blockfrost) when the
orchestrator is unreachable.

### bech32m helpers (`src/api/key-encoding.ts`)

```typescript
decodeShieldedCoinPublicKey(bech32, networkId): Uint8Array       // 32 bytes
encodeShieldedCoinPublicKey(bytes, networkId): string            // round-trip
decodeUnshieldedAddress(bech32, networkId): Uint8Array
encodeUnshieldedAddress(bytes, networkId): string
userEither(bytes): Either<ContractAddress, UserAddress>          // {is_left:false, left:{zeros32}, right:{bytes}}
```

Backed by `@midnight-ntwrk/wallet-sdk-address-format`. **Every HTLC deposit must route
`receiverAuth` through `decodeShieldedCoinPublicKey` and `{receiver,sender}Payout` through
`decodeUnshieldedAddress` + `userEither`.** The reverse-maker's counterparty-key inputs accept
either bech32m or 64-hex — both paths go through the same decoders.

## 7. Design system (`src/config/theme.ts`)

- Dark mode, **Cardano-blue primary on Midnight-dark background**.
- Primary gradient: `linear-gradient(135deg, #4B8CFF 0%, #2E7BFF 45%, #1A4FD1 100%)`.
- Surface scale: `#0A0B13` (page) → `#12131E` (card) → `#1A1C2B` (inset) → `#242738` (hover).
- Subtle radial "midnight glow" backdrop in MainLayout.
- Typography: **Inter** 400/500/600/700/800 + JetBrains Mono for hashes/addresses (via
  Google Fonts in `index.html`).
- Radii: 999 (pill buttons), 20-24 (cards), 14-16 (inputs/chips/alerts).
- Custom palette tokens on `theme.custom` — every page reads from there, so a palette
  bump propagates cleanly.

**Shared components** (reuse, don't reinvent): `AsyncButton` (spinner + disable +
wallet-popup hint after `limits.walletPopupHintMs`), `WalletGate`
(`require={{midnight, cardano}}`, blocks with install links), `SwapStatusChip`
(direction-neutral vocabulary), `ShareUrlCard` (QR 168px ECC-M + copy + `navigator.share`),
`RecoveryBanner` (polls orchestrator every 20s for reclaimable swaps), `useToast()`
(`success`/`info`/`warning`/`error`, single queued Snackbar).

## 8. Runtime config (`src/config/limits.ts`)

Every window overridable via `VITE_*`. Defaults target **realistic "wander off and come
back" UX**, not tight demos — quick-demo overrides live commented in `.env.preprod`.

```typescript
aliceMinDeadlineMin:     VITE_ALICE_MIN_DEADLINE_MIN     ?? 10    // min maker deadline
aliceDefaultDeadlineMin: VITE_ALICE_DEFAULT_DEADLINE_MIN ?? 240   // 4h outer wrapper
bobMinCardanoWindowSecs: VITE_BOB_MIN_CARDANO_WINDOW_SECS?? 600   // taker pre-check
bobSafetyBufferSecs:     VITE_BOB_SAFETY_BUFFER_SECS     ?? 300   // inner/outer gap
bobDeadlineMin:          VITE_BOB_DEADLINE_MIN           ?? 120   // 2h forward taker (Midnight)
reverseTakerDeadlineMin: VITE_REVERSE_TAKER_DEADLINE_MIN ?? 120   // 2h reverse taker (Cardano)
bobMinDepositTtlSecs:    VITE_BOB_MIN_DEPOSIT_TTL_SECS   ?? 600   // floor after truncation
browseMinRemainingSecs:  VITE_BROWSE_MIN_REMAINING_SECS  ?? 300   // Browse hides offers below this
walletPopupHintMs:       VITE_WALLET_POPUP_HINT_MS       ?? 3000
```

**Pre-flight deadline check** inside `useMakerFlow.claim()` surfaces a user-actionable
error if the entry is already expired or within 60s — avoids burning ~18 DUST on a tx
that will `SegmentFail`.

## 9. Orchestrator (`htlc-orchestrator/`, bidirectional)

Fastify + SQLite (`better-sqlite3`, WAL) + two watchers. **Advisory only; contracts are
authoritative.** If the orchestrator is down, every flow still works via direct indexer
fallback — the orchestrator just shaves 5-10s off cross-chain notifications.

### Schema

Columns `usdm_amount` / `usdc_amount`. `direction` union is `'usdm-usdc' | 'usdc-usdm'`,
default `'usdm-usdc'`, CHECK-constrained. `cardano_deadline_ms` / `cardano_lock_tx` are
nullable (filled later for reverse swaps). `db.ts` detects the legacy `'ada-usdc'` CHECK
in the table DDL and rebuilds with the new CHECK, backfilling `'ada-usdc' → 'usdm-usdc'`
and `'usdc-ada' → 'usdc-usdm'`. Both the `usdmAmount` URL param and `usdm-usdc`/`usdc-usdm`
direction strings have read-side fallbacks for legacy `adaAmount` / `ada-usdc` / `usdc-ada`
so preprod URLs in the wild still resolve.

Field semantics are direction-dependent:

| field               | `usdm-usdc` (forward)          | `usdc-usdm` (reverse)                |
|---------------------|--------------------------------|--------------------------------------|
| `aliceCpk/Unshielded` | maker's Midnight keys        | maker's Midnight keys                |
| `cardanoLockTx`     | maker lock (at create)         | taker lock (PATCHed later)           |
| `cardanoDeadlineMs` | maker deadline                 | taker deadline                       |
| `bobPkh`            | taker's Cardano PKH            | maker's own Cardano PKH              |
| `midnightDepositTx` | taker deposit (PATCHed)        | maker deposit (at create)            |
| `midnightDeadlineMs`| taker deadline                 | maker deadline                       |
| `bobCpk/bobUnshielded` | taker keys (PATCHed)        | taker keys (at create)               |
| `midnightPreimage`  | revealed on Midnight           | revealed via Cardano tx redeemer     |

### Watchers (direction-aware)

`midnight-watcher.ts`:
- `usdm-usdc`: `open→bob_deposited` on deposit; `→alice_claimed` on preimage reveal;
  `→bob_reclaimed` on `amount=0 && no preimage`.
- `usdc-usdm`: `→completed` on `amount=0 && preimage revealed`; `→alice_reclaimed` on
  `amount=0 && no preimage && past deadline`. (Midnight doesn't observe preimage-reveal
  in this direction — that's on Cardano.)

`cardano-watcher.ts`:
- `usdm-usdc`: `alice_claimed→completed` on UTxO spent; `open|bob_deposited→alice_reclaimed`
  on post-deadline spend.
- `usdc-usdm`: `open→bob_deposited` when new HTLC UTxO appears bound to maker's PKH (verified
  against `bob_pkh`); `→alice_claimed` on spend — **extracts preimage from spend tx's
  redeemer** (Blockfrost `/txs/{hash}/redeemers` + `/scripts/datum/{hash}/cbor`) and
  PATCHes `midnight_preimage` so the reverse taker's fast-path lights up before their
  Blockfrost loop; `→bob_reclaimed` on post-deadline spend with no Withdraw redeemer.

### REST API

```
POST   /api/swaps                  CreateSwapBody → Swap (409 if hash exists; direction-branched)
GET    /api/swaps?status=X&direction=Y → { swaps: Swap[] }
GET    /api/swaps/:hash            → Swap
PATCH  /api/swaps/:hash            PatchSwapBody → Swap
                                   (now accepts cardanoLockTx + cardanoDeadlineMs as
                                    patchable for reverse taker's Cardano-lock PATCH)
GET    /health                     → { ok, db }
```

Regex-based input validation (hash 64 hex, amounts non-negative bigint strings, status union).
CORS: `localhost:5199`, `5173`, `8080`.

## 10. Landmines and gotchas

### #1 bech32m ↔ Bytes<32> — RESOLVED (still active)

`withdrawWithPreimage` compares `ownPublicKey().bytes` against `receiverAuth` (raw 32
bytes). Passing bech32m strings or the wrong HD-role key fails "Only designated receiver".
`BrowserHtlcManager` decodes at bootstrap; everything downstream flows through
`key-encoding.ts`. **Never pass `connectedAPI.zswapCoinPublicKey` (bech32m) as `receiverAuth`.**

### #2 Stale Cardano UTxOs at shared script address — RESOLVED

Script address is shared across all swaps; preprod has accumulated stale UTxOs.
`watchForCardanoLock` **MUST filter by `(receiverPkh, hashHex, deadline > now)`** — all
three. Don't "simplify" the signature.

### #3 ZK asset hosting — unchanged

`FetchZkConfigProvider` fetches `${origin}/keys/<circuit>.{prover,verifier}` and
`${origin}/zkir/<circuit>.bzkir`. `predev` hook populates `public/keys/` + `public/zkir/`
from `contract/src/managed/{htlc,usdc}/`. Circuit names don't collide so flat merge works.
If `/keys/…prover` 404s, redo `npm install && npm run dev`.

### #4 Deadline-floor bug — RESOLVED

Original 2-min `bobDeadlineMin` too tight even for forward. Bumped to 120. Reverse got
its own `reverseTakerDeadlineMin=120`. Safety floors bumped from seconds to minutes.

### #5 Lace dApp-connector submit quirk — NEW, RESOLVED

Lace's `submitTransaction` sometimes rejects with `DAppConnectorAPIError / Transaction
submission error` **even though the tx landed on-chain**. Symptoms: reverse-maker
deposit "fails" but USDC is visibly escrowed; forward-taker retry fails with
"HTLC already active for this hash" (first submit succeeded).

**Fix pattern** applied in `useReverseMakerFlow.deposit` + `useTakerFlow.deposit`: on
submit throw, don't error out — poll Midnight indexer up to 45-60s for the entry. Taker
flow also verifies `receiverAuth` matches expected maker cpk (so a stranger's same-hash
deposit can't steal). If verified, continue with toast "Wallet returned an error but
the deposit landed on-chain — continuing."

Pattern could reasonably extend to `withdrawWithPreimage` / `reclaimAfterExpiry` —
not done yet.

### #6 Blockfrost UTxO-index lag — NEW, RESOLVED

Reverse taker PATCHes orchestrator immediately after Cardano lock submit; maker's
`waiting-cardano` effect picks it up and would transition to `claim-ready`. But
Blockfrost's UTxO-at-address index lags 20-30s, so a click during that window hits
"No HTLC UTxO found for hash …".

**Two-layer fix:** (1) orchestrator-fast-path poll **verifies** Blockfrost can see the
UTxO before dispatching `cardano-seen`; until then, Claim stays disabled/absent.
(2) `cardanoHtlc.claim()` retries `findHTLCUtxo` 5s × 8 attempts (40s); `reclaim()`
gets a 4-attempt budget.

### #7 Reverse-flow two-key counterparty input — NEW, MITIGATED

Reverse maker needs BOTH taker's shielded coin key (`receiverAuth`) AND unshielded
address (`receiverPayout`) — distinct HD-role keys, not derivable from each other
(Zswap vs Night layers).

**UX mitigation:** WalletMenu exposes **"Copy both (bundle)"** packaging both keys as
`cpk:unshielded`. SwapCard has a **"Paste bundle"** button, and pasting a bundle into
either text field auto-splits.

Protocol-level fix (drop `receiverAuth`, accept gas-griefing risk) proposed in
`contract.md`; not implemented.

### Gotchas (unchanged)

- **Compact map semantics:** no delete; `amount=0` = completed. Derived-state pipelines
  treat `0n` as "don't surface".
- **Blockfrost key in client bundle:** fine for preprod (rate-limited); mainnet needs a
  backend proxy.
- **Multiple Cardano APIs:** `window.cardano` can have several entries.
  `SwapContext.connectCardano(name?)` defaults to Eternl → Lace-Cardano → Nami → Flint → Typhon.
  Switching post-connect needs disconnect+reconnect.

## 11. Running it

**Prereqs:** Blockfrost preprod key in `htlc-ui/.env.preprod`; Midnight proof server at
`127.0.0.1:6300`; Midnight preprod endpoints reachable; Lace (Midnight+Cardano) OR
Lace (Midnight) + Eternl (Cardano); both wallets funded (Midnight faucet
https://faucet.preprod.midnight.network/, ~15min first sync; Cardano preprod faucet).

```bash
# 1. Compile + build
cd contract
npm run compact:htlc && npm run compact:usdc && npm run build:all
cd ../cardano && aiken build                       # regenerates plutus.json (htlc + usdm)

# 2. Deploy + mint seed USDC on Midnight, seed-mint USDM on Cardano
cd ../htlc-ft-cli
MIDNIGHT_NETWORK=preprod BLOCKFROST_API_KEY=$BLOCKFROST_API_KEY npx tsx src/setup-contract.ts
cp swap-state.json ../htlc-ui/swap-state.json

# 3. Orchestrator (recommended)
cd ../htlc-orchestrator && npm install
SWAP_STATE_PATH=../htlc-ft-cli/swap-state.json BLOCKFROST_API_KEY=$BLOCKFROST_API_KEY npm run dev

# 4. UI
cd ../htlc-ui && npm install && npm run dev
```

### Two-browser E2E

**Forward:** Browser A → `/`, connect, paste taker Cardano address, "Review & lock",
sign in Eternl → copy share URL from progress modal → Browser B opens URL, connects,
accepts, deposits → A claims USDC → B claims USDM.

**Reverse:** Browser B → WalletMenu → "Copy both (bundle)" → send string to Browser A.
Browser A → `/`, connect, flip direction, paste bundle, "Review & deposit", sign in
Lace → share URL (`direction=usdc-usdm&makerPkh=…`) → B opens, verifies, signs Cardano
lock in Eternl → A's "Claim USDM" appears after ~20-30s Blockfrost lag → A claims →
B's "Claim USDC" lights up via orchestrator fast-path or Blockfrost redeemer → B claims.

### CLI regression (forward only)

```bash
cd htlc-ft-cli
npx tsx src/execute-swap.ts            # single-process
npx tsx src/smoke-native.ts            # Midnight-only
npx tsx src/smoke-cardano-reclaim.ts   # Cardano-only
# Two-terminal: MIDNIGHT_NETWORK=preprod npx tsx src/alice-swap.ts (+ bob-swap.ts)
```

## 12. What's left for you (frontend-designer scope)

Behaviour is complete in both directions. Visual polish is the next frontier.

**A. Onboarding + empty states** — `/` with no wallets is a blank card; make it an
inviting "pick your direction" moment. `/browse`, `/activity`, `/reclaim` all have
functional empty states that could be warmer (especially `/reclaim`'s "you're good"
deserves a celebration, not a neutral info panel).

**B. Progress modal polish** — stepper is legible but dense; add contrast between
done/active/pending. Reverse-flow phase copy is drier than forward — prose pass wanted.
"Hide" is honest but doesn't explain "we'll re-open when the counterparty acts" —
close that loop with a sub-line.

**C. Error copy** — most catch blocks now have user-actionable messages (pre-flight
deadline check, verify-on-error toast, Blockfrost-lag retries) but visual treatment is
still generic MUI Alert. Four error classes want tonal differentiation: user rejected,
network/indexer, contract assertion, deadline-related. Reverse-maker's two-key input
needs a "Where do I get this?" link under each field linking to a mini-explanation.

**D. Share flow** — "Copy as QR image" alongside "Copy URL" / "Share…". Progress modal
could show "Waiting for counterparty… 2m 14s elapsed" and offer browser notification
permission for "Remind me when they act".

**E. Success confirmation** — `done` state currently shows "Funds received" + amounts.
Turn into a small celebration: share-to-social card, explorer links, "Swap again" CTA.

**F. Production concerns (not UI design but worth flagging)**

- Blockfrost key in client bundle — proxy for mainnet.
- Bundle size — `@midnight-ntwrk/*` + `@lucid-evolution/lucid` + MUI + qrcode.react is
  heavy; no tree-shake audit done.
- Orchestrator single-instance — `better-sqlite3` + local file. Horizontal scale needs
  Postgres + leader-elected watcher worker.
- CORS origins — orchestrator allows `localhost:{5199,5173,8080}` only.
- USDC `mint()` has no access control — needs gated deploy for mainnet.
- Preimage in `localStorage` — wants wallet-derived encryption for real-money use.
- Reverse-flow contract simplification (drop `receiverAuth`) — see `contract.md`.
  Removes the two-key UX wart; accepts a mempool-front-run griefing attack that burns
  gas but can't steal funds.

### G. Things to explicitly NOT change

- **Hook reducers** (`use{Maker,Taker,ReverseMaker,ReverseTaker}Flow.ts`) — mirror CLI
  reference exactly. Add states, don't restructure.
- **`BrowserHtlcManager`'s wallet-polling + semver check** — only way to coexist with
  Lace's version churn.
- **bech32m decoding pipeline in `key-encoding.ts`** — Landmine #1. Never bypass.
- **Taker safety checks** (`bobMinCardanoWindowSecs`, `bobSafetyBufferSecs`,
  `bobMinDepositTtlSecs`, `reverseTakerDeadlineMin`) — tune via `VITE_*`, don't remove.
- **Orchestrator-as-advisory model** — chain state always authoritative; every
  orchestrator call wraps `tryOrchestrator()` and falls back.
- **Contract split** (htlc + usdc) — don't join.
- **`watchForCardanoLock` signature** — `(receiverPkh, hashHex, deadline > now)` triple-filter.
- **Share URL param names** — existing URLs in the wild depend on:
  forward: `hash, aliceCpk, aliceUnshielded, cardanoDeadlineMs, usdmAmount, usdcAmount, role=bob`;
  reverse: `hash, direction=usdc-usdm, makerPkh, midnightDeadlineMs, usdmAmount, usdcAmount`.
  Legacy `adaAmount` and `direction=ada-usdc`/`usdc-ada` values are accepted as read-side
  aliases for in-flight preprod URLs.
  Keep even if renaming internals.
- **Verify-on-error patterns in deposit paths** — catches Lace quirk (Landmine #5).
- **Blockfrost index-visibility gate in reverse-maker `waiting-cardano`** — prevents
  Claim during UTxO-index lag (Landmine #6).

## 13. Key files to read first

1. `htlc-ui/src/components/swap/SwapCard.tsx` — how role × flowDirection × state drives the card.
2. `htlc-ui/src/components/swap/SwapProgressModal.tsx` — the four phase-builders.
3. `htlc-ui/src/components/swap/use{Maker,Taker,ReverseMaker,ReverseTaker}Flow.ts` — state machines.
4. `htlc-ui/src/config/{theme,limits}.ts` — palette/MUI overrides + safety windows.
5. `htlc-ui/src/components/WalletMenu.tsx` — wallet pill + key-bundle copy.
6. `htlc-ui/src/components/{Browse,Activity,Reclaim,RecoveryBanner}.tsx` — list-driven surfaces.
7. `htlc-ui/src/api/{htlc-api,cardano-htlc-browser,orchestrator-client}.ts` — tx submission + `findClaimPreimage`.
8. `htlc-orchestrator/src/{types,db,routes/swaps,midnight-watcher,cardano-watcher}.ts` — field semantics.
9. `contract.md` + `credit.md` — standing design decisions / attributions.

---

## Appendix: environment variables

### `htlc-ui/.env.preprod`

```bash
VITE_NETWORK_ID=preprod
VITE_LOGGING_LEVEL=trace
VITE_PROOF_SERVER_URI=http://127.0.0.1:6300
VITE_BLOCKFROST_API_KEY=preprod…
VITE_ORCHESTRATOR_URL=http://localhost:4000

# Optional quick-demo overrides (defaults in src/config/limits.ts are generous)
# VITE_ALICE_MIN_DEADLINE_MIN=3
# VITE_ALICE_DEFAULT_DEADLINE_MIN=10
# VITE_BOB_MIN_CARDANO_WINDOW_SECS=60
# VITE_BOB_SAFETY_BUFFER_SECS=30
# VITE_BOB_DEADLINE_MIN=3
# VITE_REVERSE_TAKER_DEADLINE_MIN=3
# VITE_BOB_MIN_DEPOSIT_TTL_SECS=60
# VITE_BROWSE_MIN_REMAINING_SECS=60
# VITE_WALLET_POPUP_HINT_MS=3000
```

### `htlc-orchestrator` env

```bash
PORT=4000
DATABASE_PATH=./data/swaps.db
SWAP_STATE_PATH=../htlc-ft-cli/swap-state.json
BLOCKFROST_API_KEY=…                              # server-side; NOT shipped to clients
MIDNIGHT_NETWORK=preprod

# Optional stuck-swap alerter
STUCK_SWAP_WEBHOOK_URL=…                          # Slack / Discord / raw JSON (auto-detected)
STUCK_SWAP_SCAN_INTERVAL_MS=60000
STUCK_SWAP_ALICE_CLAIMED_STALE_MS=900000          # 15 min
STUCK_SWAP_REALERT_MS=21600000                    # 6 h
STUCK_SWAP_PUBLIC_UI_URL=https://…                # deep-link into /reclaim
```
