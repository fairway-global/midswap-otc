# KAAMOS — Institutional OTC Settlement Across Chains (Midnight ⇄ Cardano)

> **For the next Claude session.** Two layers, both DONE and verified on preprod.
>
> **Layer 1 — HTLC atomic swap protocol.** Bidirectional Midnight USDC ⇄ Cardano USDM atomic settlement. Compact contracts, Aiken validators, browser reducers, watcher orchestrator. **Don't restructure.**
>
> **Layer 2 — KAAMOS OTC layer.** Institutional desk on top: Supabase auth, public RFQ order book, quote/counter/accept negotiation, per-deal wallet binding, bridge that hands accepted RFQs off to Layer 1. The originator's `useMakerFlow.lock` (existing) stays untouched while picking up an `rfqId` from the URL.
>
> **Read order:** §1 (what), §10 (landmines — read all 11), §11 (KAAMOS data flow), §13 (per-deal wallet binding), §14 (running it), §15 (key files). Sections 4–9 are reference material.
>
> **Code paths still say `htlc-` and reference "Midswap" in places** — the rebrand is visual / copy only.
>
> **Original implementation plan + decision log:** `~/.claude/plans/buzzing-toasting-eagle.md` (NOT in git).

---

## 1. What this is

Trustless cross-chain OTC settlement between **Midnight** (privacy L1) and **Cardano Preprod**, presented as an institutional desk.

Two flow directions:
- **`usdm-usdc` (forward)** — maker locks USDM on Cardano first → taker deposits USDC on Midnight → maker claims USDC (preimage reveals on Midnight) → taker claims USDM.
- **`usdc-usdm` (reverse)** — maker deposits USDC on Midnight first → taker locks USDM on Cardano → maker claims USDM (preimage in Cardano spend redeemer) → taker reads preimage from Blockfrost/orchestrator and claims USDC.

Mirror images, same contracts. Only client-side ordering + preimage-relay path differ.

**Protocol artefacts (Layer 1):**
- `contract/src/usdc.compact` — USDC minter over Midnight native unshielded tokens. Coins live as Zswap UTXOs; no internal balance ledger.
- `contract/src/htlc.compact` — color-parametric hash-time-locked escrow.
- `cardano/validators/htlc.ak` — Aiken→PlutusV3 HTLC, off-chain via Lucid Evolution.
- `cardano/validators/usdm.ak` — Aiken→PlutusV3 USDM minting policy, always-true. PolicyId `def68337867cb4f1f95b6b811fedbfcdd7780d10a95cc072077088ea`, asset name `USDM` (hex `5553444d`).

**OTC additions (Layer 2):** `htlc-orchestrator` extended with Supabase auth, RFQ + quote + activity tables, swap-bridge linking accepted RFQs to swap rows via optional `rfqId` field on `CreateSwapBody`.

## 2. Current status

**Layer 1 — verified on preprod:** forward + reverse two-browser swaps; CLI regression `npx tsx htlc-ft-cli/src/execute-swap.ts` (forward only).

**Layer 2 — verified locally end-to-end:** Supabase signup (admin API, no email confirmation) → sign-in → RFQ create → quote with per-quote `walletSnapshot` → counter (either side) → accept → SwapCard auto-hydration from snapshot → existing `useMakerFlow.lock` runs unchanged with `rfqId` propagated → backend stamps `Settling` → LP auto-routed via existing share URL → settlement completes → `db.patch` hook flips RFQ to `Settled`.

## 3. Repo layout

```
example-bboard/
├── CLAUDE.md
├── contract/src/{htlc,usdc}.compact + managed/         (Layer 1 contracts)
├── cardano/validators/{htlc,usdm}.ak + plutus.json     (Layer 1 contracts)
├── htlc-ft-cli/src/                                    (CLI reference, forward-only)
├── htlc-ui/                                            (frontend = KAAMOS)
│   ├── .env.preprod         TRACKED — Blockfrost only, NEVER Supabase keys
│   ├── .env.local           gitignored — VITE_SUPABASE_*
│   └── src/
│       ├── main.tsx                  Theme>Toast>SwapProvider>AuthProvider>App
│       ├── App.tsx                   routes (auth + OTC + faucet + legacy redirects)
│       ├── lib/supabase.ts           anon-key Supabase client
│       ├── contexts/
│       │   ├── BrowserHtlcManager.ts  hardest-to-rederive code (Layer 1)
│       │   ├── SwapContext.tsx        + disconnect() + reload-reconnect
│       │   └── AuthContext.tsx        Supabase session + /auth/me, NO wallet sync
│       ├── api/
│       │   ├── orchestrator-client.ts + otcApi namespace + WalletSnapshot/Rfq/Quote types
│       │   ├── swap-bridge.ts         frontend mirror of orchestrator's swap-bridge
│       │   └── (existing) htlc-api, usdc-api, key-encoding, midnight-watcher, cardano-htlc-browser, cardano-usdm
│       └── components/
│           ├── Layout/Header.tsx      auth pill + Faucet btn + WalletMenu
│           ├── auth/{Login,Signup,AuthGate}.tsx
│           ├── orderbook/{OrderBook,RfqDetail,CreateRfqModal,SubmitQuoteModal,ChainPair,RfqStatusChip}.tsx
│           ├── faucet/Faucet.tsx      ContraClear-styled, replaces /mint, /mint-usdm
│           ├── ui/index.tsx           Panel, PanelHeader primitives
│           ├── WalletMenu.tsx         TWO breathing pills (1AM teal + Lace cyan)
│           └── swap/                  SwapCard + use{Maker,Taker,ReverseMaker,ReverseTaker}Flow
└── htlc-orchestrator/
    ├── .env                 gitignored — SUPABASE_SERVICE_ROLE_KEY
    └── src/
        ├── server.ts         shared Database between SwapStore + OtcStore
        ├── db.ts             SwapStore + OtcStore + bridge hooks + validateWalletSnapshot + receiveChainFor
        ├── auth/middleware.ts  Supabase JWT verifier, requireAuth decorator
        ├── routes/{swaps,auth,rfqs,quotes,activity}.ts
        ├── services/swap-bridge.ts  rfqAmounts + composeShareUrlParams
        └── (existing) midnight-watcher, cardano-watcher, stuck-alerter
```

`ui/otc-frontend/` + `ui/otc-server/` — read-only ContraClear reference; don't import from.

**Deleted, don't restore:** `MintUsdc.tsx`, `MintUsdm.tsx` (replaced by Faucet); `AliceSwap.tsx`, `BobSwap.tsx`, `Landing.tsx`, `Dashboard.tsx`, `WalletConnect.tsx` (legacy; logic lives in the four `use*Flow` hooks + `Home.tsx` + `Activity.tsx` + `WalletMenu.tsx`).

## 4. Contracts (Layer 1)

### HTLC (`contract/src/htlc.compact`)

Circuits: `deposit`, `withdrawWithPreimage` (must equal `receiverAuth`), `reclaimAfterExpiry` (must equal `senderAuth`).

Indexer-queryable ledger: `htlcAmounts`, `htlcExpiries`, `htlcColors`, `htlcSenderAuth`, `htlcReceiverAuth`, `htlcSenderPayout`, `htlcReceiverPayout`, `revealedPreimages`. Compact maps have no delete; `amount=0` = completed. Auth (who-can-call) and payout (where-coins-go) are separate because Compact can't derive one from the other inside a circuit.

`contract.md` proposes dropping the auth maps to simplify the reverse flow — not implemented and now mostly moot since the per-deal snapshot model auto-fills the keys.

### USDC (`contract/src/usdc.compact`)

`mint` / `name` / `symbol` / `decimals` / `color`. First `mint()` captures `_color`. **No access control on `mint()`** — preprod-only.

### USDM (`cardano/validators/usdm.ak`)

Always-true minting policy. 1 USDM = 1 integer unit (no decimals). Lock UTxO carries `{ ~2 ADA min-UTxO, [usdmUnit]: qty }`. Permissionless; exposed via `/faucet?token=USDM`.

### Cardano HTLC (`cardano/validators/htlc.ak`)

- **Datum:** `{ preimageHash, sender(PKH), receiver(PKH), deadline(POSIX ms) }`
- **Withdraw:** `sha256(preimage)==hash` AND `upper_bound < deadline` AND signer=receiver.
- **Reclaim:** `lower_bound > deadline` AND signer=sender.

**Slot-alignment fix (reclaim):** `validFrom(posixMs)` floors to slot POSIX start. If `posixMs == deadline`, the strict `>` fails. Fix: `+1000ms` offset before `validFrom`. Preserved in CLI + browser drivers — leave alone.

**Claim validity:** `validTo = deadline - 30_000ms`. Pre-flight throws if window collapsed. `findHTLCUtxo` retries up to 40s for Blockfrost UTxO-index lag.

## 5. Protocol (Layer 1)

**Forward (`usdm-usdc`):** Maker generates `PREIMAGE = random32`, `HASH = SHA256(PREIMAGE)`, locks USDM on Cardano `{hash, maker_pkh, taker_pkh, deadline≈4h}`. Taker watches Cardano, finds lock by `(hash, own_pkh, deadline>now)`, deposits USDC on Midnight `{receiverAuth=maker_cpk, receiverPayout=maker_unshielded, senderPayout=taker_unshielded, deadline≈2h}`. Maker calls `withdrawWithPreimage(PREIMAGE)` on Midnight — preimage lands in `revealedPreimages[hash]`. Taker reads it, claims USDM on Cardano with `Withdraw{preimage}`.

**Reverse (`usdc-usdm`):** Maker generates preimage + hash. Obtains taker's Midnight keys via paste-bundle (legacy) OR auto from `rfq.providerWalletSnapshot` (KAAMOS). Deposits USDC on Midnight bound to taker's keys, deadline≈4h. Taker watches Midnight, locks USDM on Cardano bound to maker's PKH, deadline≈2h. Maker claims USDM with `Withdraw{preimage}` — preimage commits to Cardano spend redeemer. Taker reads preimage from Blockfrost `/txs/{hash}/redeemers` (or fast-path: orchestrator's `midnightPreimage` PATCHed by maker), claims USDC.

In both flows the second party's deadline is tighter and nested inside the first party's (5min safety buffer). **Chain state is authoritative; orchestrator is a fast-path view + preimage relay.**

## 6. Browser architecture (`htlc-ui/`)

### Bootstrap (`main.tsx`)

```
ThemeProvider > ToastProvider > SwapProvider > AuthProvider > App
```

`AuthProvider` historically lived inside `SwapProvider` so its (now-removed) wallet-bind effect could `useSwapContext`. Keep the nesting; no cycle.

### Routes (`App.tsx`)

| Path | Component | Auth | Purpose |
|---|---|---|---|
| `/` | `LandingPage` | public | Hero, no MainLayout |
| `/login`, `/signup` | `Login`, `Signup` | public | Auth |
| `/orderbook`, `/rfq/:id` | `OrderBook`, `RfqDetail` | AuthGate | OTC surface |
| `/app` aka `/swap` | `Home`/`SwapCard` | public | Maker workspace + taker share-URL target |
| `/browse`, `/activity`, `/reclaim`, `/how`, `/faucet` | (existing) | public | Layer 1 + Faucet |
| `/alice`, `/bob`, `/dashboard`, `/mint*`, `/how-to` | redirects | public | Legacy |

`/swap` stays public so the legacy taker share-URL flow (Layer 1) works without auth friction. KAAMOS routes via `/swap?role=bob&hash=…&rfqId=…` — same URL contract, plus a badge.

### `SwapCard.tsx` — heart of the swap surface

Behavior driven by `(role, flowDirection, rfqContext)`:
- **Maker, no `?rfqId`:** legacy — manual paste of counterparty keys.
- **Maker, with `?rfqId`:** KAAMOS bridge. Hydrates direction/amounts/counterparty from `rfq.providerWalletSnapshot`; renders `<CounterpartyBoundCard>` instead of paste inputs; passes `rfqId` to reducer.
- **Taker (has `?hash`):** unchanged Layer 1. `?rfqId` if present is informational badge only.
- **Flip:** in maker mode toggles direction (blocks if flow in flight); in taker mode clears URL and returns to maker.

### `SwapProgressModal.tsx`

Vertical stepper, four phases per flow. **Tx links:** Midnight → `https://explorer.1am.xyz/tx/<hash>?network=preprod` (1AM explorer). Cardano → `https://preprod.cardanoscan.io/transaction/<hash>`.

### `BrowserHtlcManager.ts` (do not touch)

1. Polls `window.midnight?.[key]` every 100ms until Lace API appears (semver `4.x` check).
2. `enable()` → `connectedAPI`.
3. Fetches `getConfiguration()`, `getShieldedAddresses()`, `getUnshieldedAddress()`.
4. **Decodes bech32m → Bytes<32>** via `key-encoding.ts` (Landmine #1).
5. Returns `SwapBootstrap` with raw bytes + hex + bech32m for both keys.

### `SwapContext.tsx`

Idempotent `connect()` + `connectCardano()` with separate inflight promises. KAAMOS additions: `disconnect()` clears local state + `kaamos:wallets-prev` localStorage. Silent reconnect on mount: reads the flag and re-`enable()`s previously-connected wallets; failures clear the flag silently (no toast).

### Watchers (`src/api/`, all accept `AbortSignal`)

- `watchForHTLCDeposit(pub, addr, hashBytes)` → `{amount, expiry, color, senderAuth, receiverAuth}` when `htlcAmounts[hash] > 0n`.
- `watchForPreimageReveal(pub, addr, hashBytes)` → preimage bytes.
- `watchForCardanoLock(cardanoHtlc, receiverPkh?, pollMs, hashHex?, signal?)` → lock info. **MUST filter by `(receiverPkh, hashHex, deadline > now)`** (Landmine #2).

### Reducer hooks (`src/components/swap/`)

`useMakerFlow`, `useTakerFlow`, `useReverseMakerFlow`, `useReverseTakerFlow`. Maker variants take optional `rfqId` and propagate it as a single field into the `createSwap` body (KAAMOS bridge). All four poll the orchestrator with chain-authoritative fallback via `tryOrchestrator`.

### bech32m helpers (`src/api/key-encoding.ts`)

`decodeShieldedCoinPublicKey`, `encodeShieldedCoinPublicKey`, `decodeUnshieldedAddress`, `encodeUnshieldedAddress`, `userEither` (wraps as `Either<ContractAddress, UserAddress>`). **Every HTLC deposit must route `receiverAuth` through `decodeShieldedCoinPublicKey` and `{receiver,sender}Payout` through `decodeUnshieldedAddress + userEither`** (Landmine #1).

## 7. Design system (`src/config/theme.ts`) — KAAMOS aurora

Black + white + teal monochrome with aurora background atmosphere. **Do not improvise.**

```
Background       #000000   pure black
Primary          #FFFFFF   text, lines, icons (NOT a colored accent)
Secondary        #8A8A8A   ghost lines, muted text
Teal accent      #2DD4BF   active states, CTAs, links, pills
Bridge cyan      #06B6D4   hover, cross-chain "atomic sync" moments
Aurora violet    #7C3AED   ATMOSPHERIC GLOWS ONLY — never foreground
Deep violet      #1E1B4B   depth glow / Midnight shield
Status: #22C55E success, #EF4444 error, #F59E0B warning
```

**Don't reintroduce indigo (#6366F1) or original Cardano blue (#0033AD/#2E7BFF) in foreground UI.** Both `theme.custom.midnightIndigo` and `theme.custom.cardanoBlue` are aliased to teal so legacy reads still resolve.

**Typography:** Inter for hero h1-h3 + panel titles; JetBrains Mono everywhere else (body, addresses, code, status). Both loaded in `index.html`.

**Radii:** 6 inputs / 8 cards / 999 pills. Dialogs / Paper / Card default to black bg + 1px white-alpha border (depth via border, not fill).

**UI primitives** (`src/components/ui/index.tsx`): `Panel`, `PanelHeader`. Reuse instead of repeating sx blocks.

## 8. Runtime config (`src/config/limits.ts`)

```
aliceMinDeadlineMin       10
aliceDefaultDeadlineMin   240
bobMinCardanoWindowSecs   600
bobSafetyBufferSecs       300
bobDeadlineMin            120
reverseTakerDeadlineMin   120
bobMinDepositTtlSecs      600
browseMinRemainingSecs    300
walletPopupHintMs         3000
```

All overridable via `VITE_*`. Pre-flight deadline check in `useMakerFlow.claim()` surfaces actionable error if entry is expired or within 60s.

## 9. Orchestrator (Layer 1)

Fastify + better-sqlite3 (WAL) + two watchers + Layer 2 OtcStore. **Advisory only; contracts are authoritative.** Down → flows still work via direct indexer fallback.

`db.ts` migration pattern: detect missing columns via `PRAGMA table_info`, additive `ALTER`. Detect legacy CHECK constraints by parsing `sqlite_master` and rebuild table. **`swaps.rfq_id`** added (Layer 2 bridge field).

### Layer 1 watchers (direction-aware)

- `midnight-watcher`: `usdm-usdc` → `open→bob_deposited→alice_claimed→completed`; `usdc-usdm` → `→completed` on `amount=0 && preimage revealed`.
- `cardano-watcher`: `usdm-usdc` → `alice_claimed→completed` on UTxO spent; `usdc-usdm` → extracts preimage from spend tx redeemer (Blockfrost `/txs/{hash}/redeemers` + `/scripts/datum/{hash}/cbor`) and PATCHes `midnight_preimage`.

### Layer 1 REST API

```
POST   /api/swaps          CreateSwapBody → Swap (409 if hash exists)
                           + optional rfqId (Layer 2 bridge linkage)
GET    /api/swaps?status=&direction=
GET    /api/swaps/:hash
PATCH  /api/swaps/:hash    PatchSwapBody → Swap
GET    /health
```

CORS: localhost:5199/5173/8080 + project mainnet origins.

## 10. Landmines and gotchas

### #1 bech32m ↔ Bytes<32> — RESOLVED

`withdrawWithPreimage` compares `ownPublicKey().bytes` against `receiverAuth` (raw 32 bytes). Bech32m strings or wrong HD-role keys fail "Only designated receiver". `BrowserHtlcManager` decodes at bootstrap; everything downstream flows through `key-encoding.ts`. **Never pass `connectedAPI.zswapCoinPublicKey` (bech32m) as `receiverAuth`.**

### #2 Stale Cardano UTxOs at shared script address — RESOLVED

`watchForCardanoLock` **MUST filter by `(receiverPkh, hashHex, deadline > now)`** — all three. Don't simplify the signature.

### #3 ZK asset hosting

`FetchZkConfigProvider` fetches `${origin}/keys/<circuit>.{prover,verifier}` and `${origin}/zkir/<circuit>.bzkir`. `predev` hook populates `public/keys/` + `public/zkir/` from `contract/src/managed/{htlc,usdc}/`. If keys 404, redo `npm install && npm run dev`.

### #4 Deadline-floor bug — RESOLVED

Original 2-min `bobDeadlineMin` was too tight. Bumped to 120. Reverse got its own `reverseTakerDeadlineMin=120`.

### #5 Lace dApp-connector submit quirk — RESOLVED

Lace's `submitTransaction` sometimes rejects with `DAppConnectorAPIError / Transaction submission error` even though the tx landed on-chain. Fix in `useReverseMakerFlow.deposit` + `useTakerFlow.deposit`: on submit throw, poll Midnight indexer up to 45-60s for the entry. Verify `receiverAuth` matches expected before continuing.

### #6 Blockfrost UTxO-index lag — RESOLVED

Two-layer fix: orchestrator-fast-path verifies Blockfrost can see the UTxO before dispatching `cardano-seen`; `cardanoHtlc.claim()` retries `findHTLCUtxo` 5s × 8 attempts; `reclaim()` gets a 4-attempt budget.

### #7 Reverse-flow two-key counterparty input — SUPERSEDED

Originally a paste-bundle UX wart. KAAMOS supersedes: `rfq.providerWalletSnapshot` flows the keys automatically. Legacy paste-bundle inputs in SwapCard remain for unauthenticated users from share URLs. WalletMenu's "Copy both — for swap binding" stays available so a counterparty can still bundle keys for the legacy path.

### #8 OTC bridge pivot — REQUIRED ARCHITECTURE

The naive idea of "synthesize a swap row at quote-accept time" is FORBIDDEN — would require the preimage hash + a real on-chain lock tx to exist before the maker has signed anything. Either (a) orchestrator generates the preimage (breaks chain-authoritative model — orchestrator is advisory), or (b) loosens `validateCreateBody` (breaks watcher's open-state assumptions).

**Instead:** swap rows are still created EXCLUSIVELY by the maker's `useMakerFlow.lock` / `useReverseMakerFlow.deposit` calling `orchestratorClient.createSwap`. The bridge linkage is a single optional `rfqId` field on `CreateSwapBody`. `createSwap` handler stamps `rfqs.swap_hash + status='Settling' + activity SETTLEMENT_STARTED` after insert; existing watchers + `db.patch` hook propagate `completed` back up to `Settled + SETTLEMENT_COMPLETED`.

### #9 Per-deal wallet snapshot, NOT global binding — REQUIRED MODEL

Each quote (and counter) carries `walletSnapshot` capturing the actor's RECEIVE-side wallet at the moment of submit/counter. On `acceptQuote`, snapshot is copied to `rfqs.provider_wallet_snapshot`. Originator's snapshot stays NULL — they commit implicitly at lock time via `session.bootstrap`. See §13 for full model.

`user_wallets` table + `PUT /api/users/me/wallet` route exist (legacy, backward-compat) but are NOT GATED ON anywhere. **Don't reintroduce wallet-bound checks** in OrderBook/RfqDetail/CreateRfqModal/SubmitQuoteModal — explicitly removed. **Don't re-add the wallet-binding sync effect to AuthContext** — deliberately deleted.

### #10 Supabase signup MUST go through server admin API

Frontend `AuthContext.signUp` calls `POST /api/auth/signup` (NOT `supabase.auth.signUp` directly). Server uses `admin.createUser({ email_confirm: true })` to skip the confirmation-email round-trip, then frontend immediately `signInWithPassword`. **Email confirmation pages are not implemented and not needed.** Don't re-add a "check your email" flow.

### #11 Secrets handling

- `htlc-ui/.env.preprod` is **TRACKED** — only public-ish keys (Blockfrost preprod).
- `htlc-ui/.env.local` is **gitignored** via `*.local` — `VITE_SUPABASE_*` keys here.
- `htlc-orchestrator/.env` is **gitignored** via `.env` — `SUPABASE_SERVICE_ROLE_KEY` here. NEVER ship to clients.

### Other (unchanged)

- Compact maps: no delete; `amount=0` = completed. Pipelines treat `0n` as "don't surface".
- Blockfrost key in client bundle: fine for preprod (rate-limited); mainnet needs a backend proxy.
- `window.cardano` may have multiple entries. `connectCardano(name?)` defaults to Eternl → Lace-Cardano → Nami → Flint → Typhon.

---

## 11. OTC layer architecture (Layer 2)

Built on top of the verified HTLC protocol. Layer 1 invariants stay untouched.

### Lifecycle (one paragraph per phase)

**Sign in** (Supabase) → `/api/auth/me` auto-provisions `otc_users`.

**Post RFQ** (originator, no wallet check) → `POST /api/rfqs {side, sellAmount, indicativeBuyAmount, expiresInSeconds}` → row with status `OpenForQuotes`, activity `RFQ_CREATED`.

**Submit quote** (counterparty) → `SubmitQuoteModal` shows `ReceiveWalletPicker` for the actor's receive chain (sell-usdm → "Connect Lace to receive USDM"; sell-usdc → "Connect 1AM to receive USDC"). On connect, snapshot is built from `useSwapContext()`. `POST /api/quotes/submit {rfqId, price, buyAmount, walletSnapshot}` → quotes row, server `validateWalletSnapshot` enforces correct chain fields, RFQ → `Negotiating`.

**Counter** (either side) → `POST /api/quotes/counter {parentQuoteId, ..., walletSnapshot}` — actor captures their own receive-side wallet. Parent quote → `Countered`; new quote v+1 → `Submitted`.

**Accept** (originator only) → `POST /api/quotes/accept {rfqId, quoteId}` → WHERE-guarded UPDATE (defeats double-accept races, returns 409); copies `quote.quoter_wallet_snapshot` → `rfqs.provider_wallet_snapshot`; marks accepted/rejected; status `QuoteSelected`; activity `QUOTE_ACCEPTED`.

**Originator routes to swap** — RfqDetail (polling 2s) sees `QuoteSelected` → `navigate('/swap?rfqId=<id>')`. SwapCard fetches RFQ, hydrates direction/amounts/counterparty from `provider` snapshot (one-shot via useRef). Manual paste inputs HIDDEN; `<CounterpartyBoundCard>` shown. Originator clicks Lock → existing `useMakerFlow.lock` runs UNCHANGED with `rfqId: params.rfqId` propagated through to `createSwap`.

**Bridge stamp** — backend `POST /api/swaps` handler: `swapStore.create(body)` (Layer 1) → `bridge.linkSwapToRfq(rfqId, hash)` if rfqId set → `UPDATE rfqs SET swap_hash=?, status='Settling'`, activity `SETTLEMENT_STARTED`.

**LP routes to settlement** — RfqDetail (polling 5s in Settling) sees `swap_hash` set → fetches swap → `composeShareUrlParams(rfq, swap)` → `navigate('/app?role=bob&hash=…&rfqId=…')`. Existing taker reducer auto-starts.

**Settle** — existing two-browser HTLC settlement runs to completion. Watchers tick swap → `completed`. `db.patch` hook: if `body.status==='completed' && row.rfq_id`, fires `bridge.markRfqSettled` → RFQ → `Settled`, activity `SETTLEMENT_COMPLETED`.

### Role mapping (locked)

- `originator ≡ maker`. `lp/quoter ≡ taker`. Always.
- `rfq.side='sell-usdm'` → `flowDirection='usdm-usdc'` (forward).
- `rfq.side='sell-usdc'` → `flowDirection='usdc-usdm'` (reverse).
- **No fixed user role.** `otc_users.is_admin` only. "Originator" vs "counterparty" is per-RFQ, derived from `rfq.originator_id === currentUser.id`.

### Polling (no WebSocket)

- `OrderBook.tsx` polls `/api/rfqs` every **3s** while tab visible (`document.visibilityState`); pauses when hidden.
- `RfqDetail.tsx` polls `/api/rfqs/:id + /api/quotes/:rfqId + /api/activity/:rfqId`: **2s** in active states, **5s** in `Settling`, stops at terminal.

WS empirically slower than this polling cadence (compared to ContraClear). Don't add WS unless metrics show otherwise.

## 12. Wallet UX

### Two-pill WalletMenu

```
[● 1AM · mn_addr…h70n ▾]   [● Lace · addr_test…yazs ▾]
```

Each pill is its own clickable target with its own dropdown. 1AM = teal; Lace = bridge-cyan. Disconnected state: dashed-border `Connect 1AM` / `Connect Lace` mini-buttons. When BOTH disconnected: a "Connect both" CTA also appears.

Each dropdown: chain header, short addresses with per-row Copy icon, balances on the Cardano side, "Disconnect both" at the bottom (clears localStorage flag).

Midnight dropdown also has **"Copy both — for swap binding"** — bundles `cpk:unshielded` so a counterparty using the legacy paste path can bind their offer.

### Reload survives connection

`SwapContext` writes `localStorage['kaamos:wallets-prev'] = {midnight, cardano}` after successful connect. On `SwapProvider` mount (one-shot via `useRef`), reads flag and silent-`enable()`s previously-connected wallets. Failures clear the flag silently. Explicit `disconnect()` clears the flag.

Supabase session also persists across reload via SDK's default `persistSession: true` (storage key `kaamos.auth.session`).

### Faucet (`src/components/faucet/Faucet.tsx`)

Replaces deleted Mint pages. Two-token selector (USDC/USDM), recipient auto-filled from connected wallet, calls existing `usdcApi.mint()` / `mintUsdm()`. Reads `?token=` for legacy redirects. Prominent amber-bordered button in Header right region (mirrors ContraClear).

### Header layout

Right region: auth pill → connection status dot → WalletMenu (two pills) → Faucet button → mobile menu toggle. Spacing `1.75` between elements; toolbar gap `{xs:2, md:3}`. Don't squeeze it back together.

## 13. OTC backend

### Auth middleware (`src/auth/middleware.ts`)

Fastify plugin. Exposes:
- `app.requireAuth` preHandler — verifies `Authorization: Bearer <jwt>` via `supabaseAdmin.auth.getUser(token)`, auto-provisions `otc_users` from `user_metadata` (`full_name`, `institution_name`), attaches `req.otcUser`. Returns 401 on failure, 503 if env missing.
- `app.supabase` — admin client used by `routes/auth.ts` for `admin.createUser` in `/auth/signup`.

If env missing, plugin still loads but every protected route returns 503 — Layer 1 `/api/swaps` keeps serving so legacy two-browser flow works.

### REST API (Layer 2)

```
POST   /api/auth/signup          { email, password, fullName, institutionName }
                                 admin.createUser w/ email_confirm:true
GET    /api/auth/me              [Bearer] → { user, wallet|null }
PUT    /api/users/me/wallet      [Bearer] → { wallet }   LEGACY, not gated
GET    /api/users/:id            → public minimal profile

GET    /api/rfqs?status=&side=&mine=
POST   /api/rfqs                 [Bearer]
GET    /api/rfqs/:id
DELETE /api/rfqs/:id             [Bearer] originator-only

GET    /api/quotes/:rfqId
POST   /api/quotes/submit        [Bearer] { ..., walletSnapshot }
POST   /api/quotes/counter       [Bearer] { ..., parentQuoteId, walletSnapshot }
POST   /api/quotes/accept        [Bearer] originator-only
POST   /api/quotes/reject        [Bearer] originator-only

GET    /api/activity/:rfqId
```

### OtcStore (`db.ts`)

Shares the `Database` handle with `SwapStore`. Opened in `server.ts` via `openDatabase()` then passed to both `openSwapStore(db, otcStore)` and `openOtcStore(db)`. **`otcStore` implements the `SwapBridge` interface** that `openSwapStore` calls into for `linkSwapToRfq` and `markRfqSettled`.

Key methods:
- `getOrCreateUserBySupabaseId` — auto-provisioner.
- `createRfq` — no wallet check; auto-generates `RFQ-NNNN`; activity `RFQ_CREATED`.
- `submitQuote` / `counterQuote` — validates `walletSnapshot` for receive chain via `receiveChainFor(rfq.side, role)`; auto-bumps version per (provider, rfq); nudges `Negotiating`.
- `acceptQuote` — WHERE-guarded transition; copies `quote.quoter_wallet_snapshot` → `rfqs.provider_wallet_snapshot`; marks others Rejected.
- `linkSwapToRfq`, `markRfqSettled` — bridge hooks.

### Schema (Layer 2 tables, all in `db.ts` migrations)

`otc_users(id, supabase_id UNIQUE, email UNIQUE, full_name, institution_name, is_admin, created_at)` · `user_wallets(user_id PK, midnight_*, cardano_*, updated_at)` *backward-compat only, not gated* · `rfqs(id, reference UNIQUE, originator_*, side, sell_amount, indicative_buy_amount, status, selected_*, accepted_price, swap_hash, originator_wallet_snapshot, provider_wallet_snapshot, ...)` *snapshots are JSON* · `quotes(id, rfq_id, provider_*, version, parent_quote_id, price, sell_amount, buy_amount, status, note, submitted_by_*, quoter_wallet_snapshot, ...)` · `activities(id, rfq_id, type, actor_*, summary, related_quote_id, created_at)`.

Migrations additive — detect missing columns via `PRAGMA table_info`, ALTER. Don't rebuild unless a CHECK changes.

### swap-bridge (`services/swap-bridge.ts` + frontend mirror at `htlc-ui/src/api/swap-bridge.ts`)

Two helpers, kept in lockstep:

- `rfqAmounts(rfq) → { direction, usdmAmount, usdcAmount }` — converts `rfq.side + sellAmount + acceptedPrice` to the swap row's amount tuple. Currently `PRICE_PRECISION = 1n` (raw integer pricing); scale via the constant for sub-integer pricing.
- `composeShareUrlParams(rfq, swap) → URLSearchParams` — builds the LP share URL. **Preserves Layer 1 param names verbatim** (in-the-wild URLs depend on them); only addition is `rfqId`.

## 14. Per-deal wallet binding — load-bearing model

**Wallets are NOT bound globally to user accounts.** Each quote (and counter) carries `walletSnapshot: WalletSnapshot` capturing the actor's RECEIVE-side wallet at the moment of submit/counter.

### Receive chain by (rfq.side, role)

```
originator   sell-usdm: receives USDC on Midnight   → midnight fields
originator   sell-usdc: receives USDM on Cardano    → cardano fields
counterparty sell-usdm: receives USDM on Cardano    → cardano fields
counterparty sell-usdc: receives USDC on Midnight   → midnight fields
```

Computed identically by `receiveChainFor` in both `db.ts` (backend) and `SubmitQuoteModal.tsx` (frontend).

### WalletSnapshot type (all fields optional)

```ts
interface WalletSnapshot {
  midnightCpkBytes?: string;        // 64-hex
  midnightUnshieldedBytes?: string; // 64-hex
  midnightCpkBech32?: string;       // mn_shield-cpk_…
  midnightUnshieldedBech32?: string;// mn_addr_…
  cardanoPkh?: string;              // 56-hex
  cardanoAddress?: string;          // addr / addr_test
}
```

Server-side `validateWalletSnapshot(snap, receiveChain)` enforces the right subset is present (regex hex + bech32 prefix); throws `OtcError 400 invalid_wallet_snapshot` otherwise.

### Frontend capture (`SubmitQuoteModal.tsx`)

Modal contains `<ReceiveWalletPicker>` that:
1. Computes `receiveChain` from `(rfq.side, currentUser is originator?)`.
2. Shows colored pill: "Connect Lace to receive USDM" or "Connect 1AM to receive USDC" (with appropriate accent + Connect button).
3. When connected, pill flips to "Lace · receive USDM ✓" with truncated address.
4. Builds snapshot from `useSwapContext().session.bootstrap` (Midnight) or `useSwapContext().cardano` (Cardano).
5. Submit DISABLED until the right wallet is connected.

Same modal serves both Submit and Counter (when `parentQuote` prop is set).

### Originator's snapshot stays NULL

The originator never pre-commits a receive wallet. They commit implicitly at lock time:
- `useMakerFlow.lock` reads `session.bootstrap.coinPublicKeyHex` etc. → swap row's `aliceCpk`/`aliceUnshielded`.
- `bobPkh` (forward = receiver-PKH; reverse = maker's-own-PKH) reads from `cardano.paymentKeyHash`.

So originator also has freedom to use any wallet per deal.

### Edge case (TODO polish)

If counterparty switched wallets after submitting a quote, claim will fail (snapshot binds maker's lock to wallet A; counterparty needs A connected to claim, B can't). At claim time, warn if `useSwapContext()` address differs from snapshot.

## 15. Running it

### Prereqs

**Layer 1:** Blockfrost preprod key in `htlc-ui/.env.preprod`; Midnight proof server at `127.0.0.1:6300`; Lace (Midnight + Cardano) OR Lace (Midnight) + Eternl (Cardano); both wallets funded.

**Layer 2:** Supabase project. Local env files (gitignored — see Landmine #11):
- `htlc-orchestrator/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `htlc-ui/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

**DO NOT add Supabase keys to `htlc-ui/.env.preprod`** — it IS tracked.

### Run sequence

```bash
# 1. (one-time) compile + seed
cd contract && npm run compact:htlc && npm run compact:usdc && npm run build:all
cd ../cardano && aiken build
cd ../htlc-ft-cli
MIDNIGHT_NETWORK=preprod BLOCKFROST_API_KEY=$BLOCKFROST_API_KEY npx tsx src/setup-contract.ts
cp swap-state.json ../htlc-ui/swap-state.json

# 2. Orchestrator (auto-loads .env via Node --env-file-if-exists)
cd ../htlc-orchestrator && npm install && npm run dev

# 3. UI
cd ../htlc-ui && npm install && npm run dev
```

Orchestrator scripts use `node --env-file-if-exists=.env --import=tsx --watch src/server.ts` so the `.env` is picked up automatically (Node 22+).

### Two-browser OTC

Browser A: `/signup` → sign in. `/orderbook` → "New order" → side, amounts, expiry. Browser B: signup as different user → click the RFQ → "Submit quote" → modal asks for receive-chain wallet → connect → submit. Browser A: counter or accept. On accept: A auto-routed to `/swap?rfqId=…` (counterparty bound, no paste needed) → click Lock → backend stamps Settling → B's RfqDetail auto-routes B to `/swap?role=bob&hash=…` → existing taker flow runs to completion.

CLI regression (Layer 1, forward only): `npx tsx htlc-ft-cli/src/execute-swap.ts`.

## 16. Key files to read first

**Layer 1:**
1. `htlc-ui/src/components/swap/SwapCard.tsx` — role × flowDirection × rfqContext drives the card.
2. `htlc-ui/src/components/swap/use{Maker,Taker,ReverseMaker,ReverseTaker}Flow.ts` — state machines.
3. `htlc-ui/src/api/{htlc-api,cardano-htlc-browser,orchestrator-client,key-encoding}.ts`.
4. `htlc-orchestrator/src/{db,server,midnight-watcher,cardano-watcher}.ts` + `routes/swaps.ts`.
5. `contract/src/{htlc,usdc}.compact` + `cardano/validators/{htlc,usdm}.ak`.

**Layer 2:**
1. `~/.claude/plans/buzzing-toasting-eagle.md` — original plan + design rationale (NOT in git).
2. `htlc-orchestrator/src/db.ts` — `OtcStore` (search "OTC Store"), bridge hooks, `validateWalletSnapshot`, `receiveChainFor`.
3. `htlc-orchestrator/src/auth/middleware.ts`.
4. `htlc-orchestrator/src/routes/{auth,rfqs,quotes,activity}.ts`.
5. `htlc-orchestrator/src/services/swap-bridge.ts`.
6. `htlc-ui/src/contexts/AuthContext.tsx` — Supabase session + /auth/me (NO wallet sync).
7. `htlc-ui/src/components/orderbook/{OrderBook,RfqDetail,SubmitQuoteModal,CreateRfqModal}.tsx`.
8. `htlc-ui/src/components/swap/SwapCard.tsx` (~line 155) — RFQ hydration block + `CounterpartyBoundCard`.
9. `htlc-ui/src/api/swap-bridge.ts` — frontend mirror of backend bridge.
10. `htlc-ui/src/components/{WalletMenu,faucet/Faucet}.tsx`.

Reference (don't import from): `ui/otc-frontend/`, `ui/otc-server/`.

## 17. What's left

Polish + production hardening:

- Hero copy on `/` — `LandingPage.tsx` is Layer-1; lead with institutional positioning, not "atomic swap / HTLC / no bridge".
- RfqDetail Activity sidebar — sticky-on-desktop, collapsed-on-mobile.
- "Your turn" badge on quote rows when originator countered.
- Originator's lock-time pre-confirmation: "About to lock 100 USDM. Counterparty receives at addr_test…".
- Accept confirmation modal (single-click is too easy for institutional use).
- Warmer empty states for `/orderbook`, `/activity`, `/reclaim`.
- Wallet-mismatch warning at claim time (see §14 edge case).
- Cross-RFQ activity view on `/activity` (currently lists raw swaps only).
- Order-book filters by side / token pair.
- Rate-limiting on `/api/auth/signup` and `/api/quotes/submit`.
- Production: Blockfrost proxy for mainnet; orchestrator single-instance (needs Postgres + leader-elected watcher for scale); USDC + USDM mint policies need access control for mainnet; preimage in `localStorage` needs wallet-derived encryption.

### Things to NOT change (consolidated)

**Layer 1:** Hook reducers (only single-line `rfqId` propagation allowed in maker variants); `BrowserHtlcManager` polling + semver check; bech32m pipeline (#1); taker safety floors; orchestrator-as-advisory + `tryOrchestrator` fallback; contract split (htlc + usdc); `watchForCardanoLock(receiverPkh, hashHex, deadline > now)` signature (#2); share-URL param names (forward `hash, aliceCpk, aliceUnshielded, cardanoDeadlineMs, usdmAmount, usdcAmount, role=bob`, reverse `hash, direction=usdc-usdm, makerPkh, midnightDeadlineMs, usdmAmount, usdcAmount`, plus `rfqId` and legacy `adaAmount`/`ada-usdc`/`usdc-ada` aliases); verify-on-error in deposits (#5); Blockfrost index-visibility gate in reverse-maker (#6).

**Layer 2:** Bridge pivot — `acceptQuote` does NOT create a swap row (#8); per-deal `walletSnapshot` model — NO global `user_wallets` gating, NO wallet-bind sync in `AuthContext` (#9); server-side signup via `admin.createUser({email_confirm:true})` (#10); `composeShareUrlParams` param names preserved verbatim; `validateWalletSnapshot` per-chain validation; `db.patch` propagation hook flips RFQ to `Settled` atomically; originator's snapshot stays NULL on `rfqs`; WalletMenu = two pills (1AM teal + Lace cyan); Faucet = single page; Midnight tx links → 1AM explorer; polling not WS with visibility-aware intervals; reload survives wallet connection via `kaamos:wallets-prev`.

---

## Appendix: env vars

### `htlc-ui/.env.preprod` (TRACKED — public-ish only)

```bash
VITE_NETWORK_ID=preprod
VITE_LOGGING_LEVEL=trace
VITE_PROOF_SERVER_URI=http://127.0.0.1:6300
VITE_BLOCKFROST_API_KEY=preprod…
VITE_ORCHESTRATOR_URL=http://localhost:4000
# Quick-demo overrides — defaults in src/config/limits.ts are generous:
# VITE_ALICE_MIN_DEADLINE_MIN, VITE_ALICE_DEFAULT_DEADLINE_MIN,
# VITE_BOB_MIN_CARDANO_WINDOW_SECS, VITE_BOB_SAFETY_BUFFER_SECS,
# VITE_BOB_DEADLINE_MIN, VITE_REVERSE_TAKER_DEADLINE_MIN,
# VITE_BOB_MIN_DEPOSIT_TTL_SECS, VITE_BROWSE_MIN_REMAINING_SECS,
# VITE_WALLET_POPUP_HINT_MS
```

### `htlc-ui/.env.local` (GITIGNORED)

```bash
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### `htlc-orchestrator/.env` (GITIGNORED)

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...    # NEVER ship to clients
```

Other orchestrator vars (optional, can go in `.env`): `PORT=4000`, `DB_PATH`, `LOG_LEVEL`, `BLOCKFROST_API_KEY`, `MIDNIGHT_NETWORK=preprod`, `CORS_ORIGINS`, `STUCK_SWAP_*`. See `.env.example`.
