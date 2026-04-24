import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateSwapBody, FlowDirection, PatchSwapBody, Swap, SwapStatus } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SwapRow {
  hash: string;
  direction: FlowDirection;
  alice_cpk: string;
  alice_unshielded: string;
  usdm_amount: string;
  usdc_amount: string;
  cardano_deadline_ms: number | null;
  cardano_lock_tx: string | null;
  bob_cpk: string | null;
  bob_unshielded: string | null;
  bob_pkh: string | null;
  midnight_deadline_ms: number | null;
  midnight_deposit_tx: string | null;
  midnight_claim_tx: string | null;
  cardano_claim_tx: string | null;
  cardano_reclaim_tx: string | null;
  midnight_reclaim_tx: string | null;
  midnight_preimage: string | null;
  status: SwapStatus;
  created_at: number;
  updated_at: number;
}

const rowToSwap = (row: SwapRow): Swap => ({
  hash: row.hash,
  direction: row.direction,
  aliceCpk: row.alice_cpk,
  aliceUnshielded: row.alice_unshielded,
  usdmAmount: row.usdm_amount,
  usdcAmount: row.usdc_amount,
  cardanoDeadlineMs: row.cardano_deadline_ms,
  cardanoLockTx: row.cardano_lock_tx,
  bobCpk: row.bob_cpk,
  bobUnshielded: row.bob_unshielded,
  bobPkh: row.bob_pkh,
  midnightDeadlineMs: row.midnight_deadline_ms,
  midnightDepositTx: row.midnight_deposit_tx,
  midnightClaimTx: row.midnight_claim_tx,
  cardanoClaimTx: row.cardano_claim_tx,
  cardanoReclaimTx: row.cardano_reclaim_tx,
  midnightReclaimTx: row.midnight_reclaim_tx,
  midnightPreimage: row.midnight_preimage,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface SwapStore {
  create(body: CreateSwapBody): Swap;
  get(hash: string): Swap | undefined;
  list(filter?: { status?: SwapStatus; direction?: FlowDirection }): Swap[];
  patch(hash: string, body: PatchSwapBody): Swap | undefined;
  close(): void;
}

export const openSwapStore = (dbPath: string): SwapStore => {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Step 1 — ensure the base table exists (no-op if already present).
  const schema = readFileSync(resolve(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Step 2 — additive column migrations for DBs created under the original
  // (forward-only) schema. Must run BEFORE index creation because some indexes
  // reference the new columns.
  const existingCols = db.prepare('PRAGMA table_info(swaps)').all() as Array<{
    name: string;
    notnull: number;
  }>;
  const colNames = new Set(existingCols.map((c) => c.name));
  if (!colNames.has('midnight_preimage')) {
    db.exec('ALTER TABLE swaps ADD COLUMN midnight_preimage TEXT');
  }
  if (!colNames.has('direction')) {
    db.exec(`ALTER TABLE swaps ADD COLUMN direction TEXT NOT NULL DEFAULT 'usdm-usdc'`);
  }

  // Step 3 — legacy NOT-NULL rebuild. Older schemas declared
  // `cardano_deadline_ms` and `cardano_lock_tx` NOT NULL; the reverse flow
  // needs them nullable (taker fills them later). SQLite can't drop NOT NULL
  // in place, so we rebuild the table preserving every row.
  const legacyCardanoLockTx = existingCols.find((c) => c.name === 'cardano_lock_tx');
  const legacyCardanoDeadlineMs = existingCols.find((c) => c.name === 'cardano_deadline_ms');
  if (
    (legacyCardanoLockTx && legacyCardanoLockTx.notnull === 1) ||
    (legacyCardanoDeadlineMs && legacyCardanoDeadlineMs.notnull === 1)
  ) {
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE swaps_new (
          hash TEXT PRIMARY KEY,
          direction TEXT NOT NULL DEFAULT 'usdm-usdc'
            CHECK (direction IN ('usdm-usdc', 'usdc-usdm')),
          alice_cpk TEXT NOT NULL,
          alice_unshielded TEXT NOT NULL,
          usdm_amount TEXT NOT NULL,
          usdc_amount TEXT NOT NULL,
          cardano_deadline_ms INTEGER,
          cardano_lock_tx TEXT,
          bob_pkh TEXT,
          midnight_deadline_ms INTEGER,
          midnight_deposit_tx TEXT,
          bob_cpk TEXT,
          bob_unshielded TEXT,
          midnight_claim_tx TEXT,
          cardano_claim_tx TEXT,
          cardano_reclaim_tx TEXT,
          midnight_reclaim_tx TEXT,
          midnight_preimage TEXT,
          status TEXT NOT NULL CHECK (status IN (
            'open','bob_deposited','alice_claimed','completed',
            'alice_reclaimed','bob_reclaimed','expired'
          )),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      db.exec(`
        INSERT INTO swaps_new SELECT
          hash, direction, alice_cpk, alice_unshielded, usdm_amount, usdc_amount,
          cardano_deadline_ms, cardano_lock_tx, bob_pkh,
          midnight_deadline_ms, midnight_deposit_tx, bob_cpk, bob_unshielded,
          midnight_claim_tx, cardano_claim_tx, cardano_reclaim_tx, midnight_reclaim_tx,
          midnight_preimage, status, created_at, updated_at
        FROM swaps
      `);
      db.exec('DROP TABLE swaps');
      db.exec('ALTER TABLE swaps_new RENAME TO swaps');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // Step 3b — direction-CHECK rebuild. DBs created before the ADA→USDM
  // rename carry `CHECK (direction IN ('ada-usdc','usdc-ada'))` and rows
  // populated with those literals. SQLite can't alter CHECK in place, so we
  // detect the old CHECK in sqlite_master and rebuild if present, backfilling
  // direction values at the same time.
  const tableDdl =
    (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='swaps'")
        .get() as { sql?: string } | undefined
    )?.sql ?? '';
  if (tableDdl.includes("'ada-usdc'") || tableDdl.includes("'usdc-ada'")) {
    // The legacy table's amount column is named `ada_amount`; alias it to
    // `usdm_amount` during the rebuild. If the column was already renamed in
    // a prior partial run, keep it as-is.
    const hasAdaAmount = existingCols.some((c) => c.name === 'ada_amount');
    const hasUsdmAmount = existingCols.some((c) => c.name === 'usdm_amount');
    const amountSelect = hasUsdmAmount
      ? 'usdm_amount'
      : hasAdaAmount
        ? 'ada_amount AS usdm_amount'
        : "'0' AS usdm_amount"; // shouldn't happen, but safest fallback

    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE swaps_new (
          hash TEXT PRIMARY KEY,
          direction TEXT NOT NULL DEFAULT 'usdm-usdc'
            CHECK (direction IN ('usdm-usdc', 'usdc-usdm')),
          alice_cpk TEXT NOT NULL,
          alice_unshielded TEXT NOT NULL,
          usdm_amount TEXT NOT NULL,
          usdc_amount TEXT NOT NULL,
          cardano_deadline_ms INTEGER,
          cardano_lock_tx TEXT,
          bob_pkh TEXT,
          midnight_deadline_ms INTEGER,
          midnight_deposit_tx TEXT,
          bob_cpk TEXT,
          bob_unshielded TEXT,
          midnight_claim_tx TEXT,
          cardano_claim_tx TEXT,
          cardano_reclaim_tx TEXT,
          midnight_reclaim_tx TEXT,
          midnight_preimage TEXT,
          status TEXT NOT NULL CHECK (status IN (
            'open','bob_deposited','alice_claimed','completed',
            'alice_reclaimed','bob_reclaimed','expired'
          )),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      db.exec(`
        INSERT INTO swaps_new SELECT
          hash,
          CASE direction
            WHEN 'ada-usdc' THEN 'usdm-usdc'
            WHEN 'usdc-ada' THEN 'usdc-usdm'
            ELSE direction
          END AS direction,
          alice_cpk, alice_unshielded, ${amountSelect}, usdc_amount,
          cardano_deadline_ms, cardano_lock_tx, bob_pkh,
          midnight_deadline_ms, midnight_deposit_tx, bob_cpk, bob_unshielded,
          midnight_claim_tx, cardano_claim_tx, cardano_reclaim_tx, midnight_reclaim_tx,
          midnight_preimage, status, created_at, updated_at
        FROM swaps
      `);
      db.exec('DROP TABLE swaps');
      db.exec('ALTER TABLE swaps_new RENAME TO swaps');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // Step 4 — indexes (now safe because `direction` etc. definitely exist).
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_status     ON swaps(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_direction  ON swaps(direction)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_alice_cpk  ON swaps(alice_cpk)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_bob_cpk    ON swaps(bob_cpk)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_bob_pkh    ON swaps(bob_pkh)');

  // The reverse flow lets the maker pre-populate many more fields at creation
  // than the forward flow, so we build the INSERT dynamically.
  const createSwap = (body: CreateSwapBody): Swap => {
    const now = Date.now();
    const direction: FlowDirection = body.direction ?? 'usdm-usdc';
    const columns: Record<string, unknown> = {
      hash: body.hash,
      direction,
      alice_cpk: body.aliceCpk,
      alice_unshielded: body.aliceUnshielded,
      usdm_amount: body.usdmAmount,
      usdc_amount: body.usdcAmount,
      cardano_deadline_ms: body.cardanoDeadlineMs ?? null,
      cardano_lock_tx: body.cardanoLockTx ?? null,
      bob_pkh: body.bobPkh ?? null,
      midnight_deadline_ms: body.midnightDeadlineMs ?? null,
      midnight_deposit_tx: body.midnightDepositTx ?? null,
      bob_cpk: body.bobCpk ?? null,
      bob_unshielded: body.bobUnshielded ?? null,
      status: 'open' as SwapStatus,
      created_at: now,
      updated_at: now,
    };
    const cols = Object.keys(columns);
    const placeholders = cols.map((c) => `@${c}`).join(', ');
    const sql = `INSERT INTO swaps (${cols.join(', ')}) VALUES (${placeholders})`;
    db.prepare(sql).run(columns);
    const row = getStmt.get(body.hash);
    if (!row) throw new Error('insert succeeded but row not found');
    return rowToSwap(row);
  };

  const getStmt = db.prepare<[string], SwapRow>('SELECT * FROM swaps WHERE hash = ?');
  const listAllStmt = db.prepare<[], SwapRow>('SELECT * FROM swaps ORDER BY created_at DESC');
  const listByStatusStmt = db.prepare<[SwapStatus], SwapRow>(
    'SELECT * FROM swaps WHERE status = ? ORDER BY created_at DESC',
  );
  const listByDirectionStmt = db.prepare<[FlowDirection], SwapRow>(
    'SELECT * FROM swaps WHERE direction = ? ORDER BY created_at DESC',
  );
  const listByStatusAndDirectionStmt = db.prepare<[SwapStatus, FlowDirection], SwapRow>(
    'SELECT * FROM swaps WHERE status = ? AND direction = ? ORDER BY created_at DESC',
  );

  const patchableColumns: Record<keyof PatchSwapBody, string> = {
    bobCpk: 'bob_cpk',
    bobUnshielded: 'bob_unshielded',
    bobPkh: 'bob_pkh',
    cardanoDeadlineMs: 'cardano_deadline_ms',
    cardanoLockTx: 'cardano_lock_tx',
    midnightDeadlineMs: 'midnight_deadline_ms',
    midnightDepositTx: 'midnight_deposit_tx',
    midnightClaimTx: 'midnight_claim_tx',
    cardanoClaimTx: 'cardano_claim_tx',
    cardanoReclaimTx: 'cardano_reclaim_tx',
    midnightReclaimTx: 'midnight_reclaim_tx',
    midnightPreimage: 'midnight_preimage',
    status: 'status',
  };

  return {
    create: createSwap,

    get(hash) {
      const row = getStmt.get(hash);
      return row ? rowToSwap(row) : undefined;
    },

    list(filter) {
      let rows: SwapRow[];
      if (filter?.status && filter.direction) {
        rows = listByStatusAndDirectionStmt.all(filter.status, filter.direction);
      } else if (filter?.status) {
        rows = listByStatusStmt.all(filter.status);
      } else if (filter?.direction) {
        rows = listByDirectionStmt.all(filter.direction);
      } else {
        rows = listAllStmt.all();
      }
      return rows.map(rowToSwap);
    },

    patch(hash, body) {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { hash, now: Date.now() };

      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        const column = patchableColumns[key as keyof PatchSwapBody];
        if (!column) continue;
        setClauses.push(`${column} = @${key}`);
        params[key] = value;
      }

      if (setClauses.length === 0) {
        return this.get(hash);
      }

      setClauses.push('updated_at = @now');
      const sql = `UPDATE swaps SET ${setClauses.join(', ')} WHERE hash = @hash`;
      const result = db.prepare(sql).run(params);
      if (result.changes === 0) return undefined;
      return this.get(hash);
    },

    close() {
      db.close();
    },
  };
};
