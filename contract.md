# Midnight HTLC — proposed one-address simplification

Background notes for a planned contract change. Written so it can be picked up
later without re-reading the chat where it was decided.

## The problem

In the reverse (USDC → ADA) maker flow, the Midswap UI asks the user for **two
counterparty fields**:

1. Counterparty Midnight **shielded coin key** (bech32m `mn_shield-cpk_…` or 64
   hex)
2. Counterparty Midnight **unshielded address** (bech32m `mn_addr_…` or 64 hex)

These are not the same value — they come from two different HD-derivation
paths on the Midnight wallet seed (the Zswap shielded role vs. the Night
unshielded role) and are cryptographically unrelated. You can't derive one
from the other.

The forward (ADA → USDC) flow hides the pain because the counterparty's
Midnight keys are captured from **their own deposit transaction** on-chain
(via `htlcSenderAuth` and `htlcSenderPayout`), so the maker never has to ask.
In the reverse flow, the maker goes first and must therefore specify the
receiver's credentials at deposit time — hence two fields.

## Why the current contract needs both

In `contract/src/htlc.compact`:

```compact
export ledger htlcReceiverAuth:    Map<Bytes<32>, Bytes<32>>;                        // shielded key
export ledger htlcReceiverPayout:  Map<Bytes<32>, Either<ContractAddress, UserAddress>>;  // unshielded dest

export circuit withdrawWithPreimage(preimage: Bytes<32>): [] {
  ...
  assert(ownPublicKey().bytes == htlcReceiverAuth.lookup(hash), "Only designated receiver can withdraw");
  ...
  sendUnshielded(color, amount, htlcReceiverPayout.lookup(hash));
}
```

The two primitives operate on two different layers:

- **`ownPublicKey().bytes`** — in-circuit identity. Returns the caller's
  **shielded** Zswap coin public key. This is what gates the claim.
- **`sendUnshielded(color, amount, dest)`** — payment. Delivers coins into an
  **unshielded** UTxO at an unshielded address.

Because Compact's only in-circuit identity primitive is `ownPublicKey()`
(shielded), the receiver authentication must use the shielded key. The payout
must use the unshielded address, because that's what the Night wallet indexes.
Hence two fields.

The same split applies to `htlcSenderAuth` / `htlcSenderPayout` in the
`reclaimAfterExpiry` path.

## What's actually load-bearing for atomicity

Atomic-swap safety ("either both sides settle or both sides reclaim, no one
can steal") rests on three things:

1. **Hashlock** — claim requires the preimage; `sha256(preimage) == hash`.
2. **Timelock** — after the deadline, only reclaim is allowed.
3. **Payout destination** — coins always flow to the pre-set `receiverPayout`
   (claim) or `senderPayout` (reclaim).

`receiverAuth` and `senderAuth` are **not** load-bearing for atomicity. They
only decide *who is allowed to submit the transaction that triggers the
payout*. Even without them, the payout still goes to the pre-set destination.

## Proposed change — drop auth, keep payout

Remove `htlcReceiverAuth`, `htlcSenderAuth`, and the two `ownPublicKey()`
assertions. Keep `htlcReceiverPayout` and `htlcSenderPayout`. The circuits
enforce only hashlock + timelock.

```compact
// Keep
export ledger htlcAmounts:         Map<Bytes<32>, Uint<128>>;
export ledger htlcExpiries:        Map<Bytes<32>, Uint<64>>;
export ledger htlcColors:          Map<Bytes<32>, Bytes<32>>;
export ledger htlcSenderPayout:    Map<Bytes<32>, Either<ContractAddress, UserAddress>>;
export ledger htlcReceiverPayout:  Map<Bytes<32>, Either<ContractAddress, UserAddress>>;
export ledger revealedPreimages:   Map<Bytes<32>, Bytes<32>>;

// DROP
// export ledger htlcSenderAuth:   Map<Bytes<32>, Bytes<32>>;
// export ledger htlcReceiverAuth: Map<Bytes<32>, Bytes<32>>;

export circuit deposit(
  color: Bytes<32>,
  amount: Uint<128>,
  hash: Bytes<32>,
  expiry: Uint<64>,
  receiverPayout: Either<ContractAddress, UserAddress>,
  senderPayout:   Either<ContractAddress, UserAddress>,
): [] {
  receiveUnshielded(color, amount);
  htlcAmounts.insert(disclose(hash), disclose(amount));
  htlcExpiries.insert(disclose(hash), disclose(expiry));
  htlcColors.insert(disclose(hash), disclose(color));
  htlcReceiverPayout.insert(disclose(hash), disclose(receiverPayout));
  htlcSenderPayout.insert(disclose(hash), disclose(senderPayout));
}

export circuit withdrawWithPreimage(preimage: Bytes<32>): [] {
  const hash = persistentHash<Bytes<32>>(preimage);
  const amount = htlcAmounts.lookup(hash);
  assert(amount > 0, "Already settled");
  // NO auth check — anyone with a valid preimage can trigger the payout.
  revealedPreimages.insert(hash, preimage);
  htlcAmounts.insert(hash, 0);
  sendUnshielded(htlcColors.lookup(hash), amount, htlcReceiverPayout.lookup(hash));
}

export circuit reclaimAfterExpiry(hash: Bytes<32>): [] {
  const amount = htlcAmounts.lookup(hash);
  assert(amount > 0, "Already settled");
  assert(htlcExpiries.lookup(hash) < currentTimeSecs(), "Not yet expired");
  // NO auth check — anyone can trigger reclaim after the deadline.
  htlcAmounts.insert(hash, 0);
  sendUnshielded(htlcColors.lookup(hash), amount, htlcSenderPayout.lookup(hash));
}
```

## The trade-off we accept

**Front-running griefing on the reveal tx.** An adversary watching the
Midnight mempool can see Alice's `withdrawWithPreimage(preimage)` tx, grab the
preimage from it, and submit their own claim tx with a higher fee. The
adversary's tx lands first, sets `htlcAmounts[hash] = 0`, and Alice's tx
reverts on the `assert(amount > 0)` line.

What Alice loses: the gas on her failed tx.
What Alice still gets: her USDC — the adversary's tx called
`sendUnshielded(…, htlcReceiverPayout)`, which is still Alice's unshielded
address.
What Bob sees: preimage on-chain → Bob claims ADA on Cardano → swap completes.

**No funds can be stolen.** The attack is a bounded gas-burn, not theft. Same
reasoning for `reclaimAfterExpiry`: anyone can trigger it after the deadline,
but coins go to `senderPayout`.

For preprod / demo this is acceptable. For mainnet with real value you'd
either keep the auth fields or add a dedicated mitigation (e.g. a
commit-reveal round, or a `claimer == tx-output-recipient` assertion if
Compact ever exposes a primitive for it).

## Benefits

- **Midswap UX**: one address field instead of two in the reverse-maker flow.
  The counterparty pastes only their unshielded address.
- **Share URL shrinks**: forward flow no longer needs `aliceCpk`, reverse flow
  no longer needs a separate shielded key.
- **CLAUDE.md Landmine #1 (bech32m → Bytes<32> for shielded key) becomes
  irrelevant for HTLC** — that decode pipeline stays only for wallet-identity
  display, not for contract calls.
- **Slightly better on-chain privacy** — the shielded key is no longer
  committed to the HTLC ledger.
- Smaller circuit, fewer ledger entries per swap, shorter zkir.

## Implementation checklist (when picking this up)

1. **Contract** — `contract/src/htlc.compact`
   - Remove `htlcSenderAuth`, `htlcReceiverAuth` ledger declarations.
   - Remove `receiverAuth` / `senderAuth` from `deposit` circuit signature.
   - Remove the two `ownPublicKey()` asserts in `withdrawWithPreimage` and
     `reclaimAfterExpiry`.
   - Remove the `disclose(ownPublicKey().bytes)` line that populated
     `htlcSenderAuth`.
2. **Recompile** — `cd contract && npm run compact:htlc && npm run build:all`.
   Contract address will change on redeploy (ZK keys regenerate).
3. **Redeploy** — `cd htlc-ft-cli && MIDNIGHT_NETWORK=preprod npx tsx
   src/setup-contract.ts`, copy the new `swap-state.json` into `htlc-ui/`.
4. **CLI** — every `htlc.deposit(...)` call in `htlc-ft-cli/src/*` drops
   `receiverAuth` and `senderAuth` params. The CLI reference flows
   (`alice-swap.ts`, `bob-swap.ts`, `execute-swap.ts`, smokes) must be
   regenerated and re-run.
5. **TS surface** — `htlc-ui/src/api/htlc-api.ts` `DepositParams` interface
   drops `receiverAuth` and `senderAuth`. `HTLCEntry` in
   `common-types.ts` drops `senderAuth` / `receiverAuth`.
6. **UI hooks** — `useMakerFlow`, `useTakerFlow`, `useReverseMakerFlow`,
   `useReverseTakerFlow` stop passing the auth fields. `parseUrlInputs` can
   drop `aliceCpk`. `parseReverseUrl` doesn't need a counterparty cpk field.
7. **SwapCard** — reverse-maker form drops the "Counterparty Midnight shielded
   coin key" input. Only the unshielded address remains. `resolveMidnightCpk`
   helper becomes dead code.
8. **Orchestrator** — `htlc-orchestrator/src/types.ts` can keep `aliceCpk` /
   `bobCpk` for wallet identity (they're useful for the Activity/Browse
   pages), but they're no longer required for protocol correctness. The
   `midnight-watcher.ts` doesn't need to read them from HTLC state anymore.
9. **CLAUDE.md** — update §4 (contract schema) and §11 Landmine #1 (the
   bech32m pipeline is no longer needed on the HTLC path). Call out the
   griefing-for-UX trade-off.
10. **Verify** — CLI regression (`execute-swap.ts`, smokes) + two-browser
    preprod swap in both directions.

## Alternative if the full rewrite is too invasive

Keep the `auth` fields but make them optional — a sentinel `0x00…00` in
`htlcReceiverAuth[hash]` means "no auth check, anyone with preimage can
claim":

```compact
const stored = htlcReceiverAuth.lookup(hash);
const zero: Bytes<32> = ...zeros;
if (stored != zero) {
  assert(ownPublicKey().bytes == stored, "Only designated receiver");
}
```

Pros: backward-compatible with existing deposits.
Cons: two code paths, foot-gun if someone accidentally passes zeros, doesn't
let us delete the bech32m-decode-to-shielded-key pipeline. Only recommended
if there's a constraint against redeploying contracts.

## Decision pending

**Recommendation:** ship the full drop-auth change for preprod / demo. The
UX win is substantial and the accepted threat (gas-burn griefing) is minor on
testnet. Revisit before any mainnet deployment.
