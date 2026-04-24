-- Fresh-install schema. Indexes and any additive column migrations live in
-- `db.ts` so that loading an older database (pre-direction column) works —
-- we add missing columns before trying to index them.

CREATE TABLE IF NOT EXISTS swaps (
  hash                  TEXT PRIMARY KEY,

  -- Flow direction — set at creation, never changes.
  --   'usdm-usdc' — maker locks ADA on Cardano first, taker deposits USDC on Midnight
  --   'usdc-usdm' — maker deposits USDC on Midnight first, taker locks ADA on Cardano
  direction             TEXT NOT NULL DEFAULT 'usdm-usdc'
                          CHECK (direction IN ('usdm-usdc', 'usdc-usdm')),

  -- Maker's Midnight credentials (always set at creation, regardless of direction).
  alice_cpk             TEXT NOT NULL,
  alice_unshielded      TEXT NOT NULL,
  usdm_amount            TEXT NOT NULL,
  usdc_amount           TEXT NOT NULL,

  -- Cardano side. See field-semantics table in CLAUDE.md / contract.md.
  cardano_deadline_ms   INTEGER,
  cardano_lock_tx       TEXT,
  bob_pkh               TEXT,

  -- Midnight side.
  midnight_deadline_ms  INTEGER,
  midnight_deposit_tx   TEXT,
  bob_cpk               TEXT,
  bob_unshielded        TEXT,

  -- Claim / reclaim receipts (set by watchers).
  midnight_claim_tx     TEXT,
  cardano_claim_tx      TEXT,
  cardano_reclaim_tx    TEXT,
  midnight_reclaim_tx   TEXT,

  -- Preimage. Populated by whichever chain's claim reveals it first:
  --   ada-usdc → revealed on Midnight via `revealedPreimages`
  --   usdc-ada → revealed on Cardano via the claim tx redeemer
  midnight_preimage     TEXT,

  status                TEXT NOT NULL CHECK (status IN (
                          'open',
                          'bob_deposited',
                          'alice_claimed',
                          'completed',
                          'alice_reclaimed',
                          'bob_reclaimed',
                          'expired'
                        )),

  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
