import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
  Activity,
  ActivityType,
  CounterQuoteInput,
  CreateRfqInput,
  CreateSwapBody,
  FlowDirection,
  OtcUser,
  PatchSwapBody,
  Quote,
  QuoteStatus,
  Rfq,
  RfqStatus,
  RfqSide,
  SubmitQuoteInput,
  Swap,
  SwapStatus,
  UserWallet,
  UserWalletInput,
} from './types.js';

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
  rfq_id: string | null;
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
  rfqId: row.rfq_id,
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

/**
 * Open a shared Database handle with the standard pragmas. Both
 * `openSwapStore` and `openOtcStore` accept either an open handle or a
 * path; passing the same handle lets them share the connection + WAL.
 */
export const openDatabase = (dbPath: string): Database.Database => {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
};

/**
 * The bridge surface the swap store calls when a `rfqId` is set on a
 * createSwap body or a `completed` patch arrives. Wired up by `openOtcStore`
 * and passed back into `openSwapStore` via `attachOtcBridge` so the swap
 * store stays decoupled from OTC concerns when the OTC store isn't loaded.
 */
export interface SwapBridge {
  linkSwapToRfq(rfqId: string, swapHash: string): void;
  markRfqSettled(rfqId: string, swapHash: string): void;
}

export const openSwapStore = (
  dbOrPath: string | Database.Database,
  bridge?: SwapBridge,
): SwapStore => {
  const db = typeof dbOrPath === 'string' ? openDatabase(dbOrPath) : dbOrPath;

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
  if (!colNames.has('rfq_id')) {
    db.exec('ALTER TABLE swaps ADD COLUMN rfq_id TEXT');
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
          rfq_id TEXT,
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
          midnight_preimage, rfq_id, status, created_at, updated_at
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
    const hasAdaAmount = existingCols.some((c) => c.name === 'ada_amount');
    const hasUsdmAmount = existingCols.some((c) => c.name === 'usdm_amount');
    const amountSelect = hasUsdmAmount
      ? 'usdm_amount'
      : hasAdaAmount
        ? 'ada_amount AS usdm_amount'
        : "'0' AS usdm_amount";

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
          rfq_id TEXT,
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
          midnight_preimage, NULL AS rfq_id, status, created_at, updated_at
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

  // Step 4 — indexes (now safe because every column definitely exists).
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_status     ON swaps(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_direction  ON swaps(direction)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_alice_cpk  ON swaps(alice_cpk)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_bob_cpk    ON swaps(bob_cpk)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_bob_pkh    ON swaps(bob_pkh)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_swaps_rfq_id     ON swaps(rfq_id)');

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
      rfq_id: body.rfqId ?? null,
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

    // Bridge: link to the RFQ and stamp it Settling.
    if (body.rfqId && bridge) {
      try {
        bridge.linkSwapToRfq(body.rfqId, body.hash);
      } catch (err) {
        // Bridge errors are non-fatal — the swap row already exists; the OTC
        // layer is advisory. Surface for observability without breaking the
        // chain-authoritative create.
        console.error('[bridge] linkSwapToRfq failed', err);
      }
    }
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
      const updated = this.get(hash);

      // Bridge propagation: if the swap completed and is RFQ-linked, the
      // RFQ also needs to flip to Settled. Watchers tick swap status; this
      // is the one transition that should bubble back up to the OTC layer.
      if (updated && body.status === 'completed' && updated.rfqId && bridge) {
        try {
          bridge.markRfqSettled(updated.rfqId, hash);
        } catch (err) {
          console.error('[bridge] markRfqSettled failed', err);
        }
      }
      return updated;
    },

    close() {
      db.close();
    },
  };
};

// ──────────────────────────────────────────────────────────────────────
// OTC Store
// ──────────────────────────────────────────────────────────────────────

interface OtcUserRow {
  id: string;
  supabase_id: string;
  email: string;
  full_name: string;
  institution_name: string | null;
  is_admin: number;
  created_at: number;
}

interface UserWalletRow {
  user_id: string;
  midnight_cpk_bytes: string;
  midnight_unshielded_bytes: string;
  midnight_cpk_bech32: string;
  midnight_unshielded_bech32: string;
  cardano_pkh: string;
  cardano_address: string;
  updated_at: number;
}

interface RfqRow {
  id: string;
  reference: string;
  originator_id: string;
  originator_name: string;
  originator_email: string;
  side: RfqSide;
  sell_amount: string;
  indicative_buy_amount: string;
  status: RfqStatus;
  selected_quote_id: string | null;
  selected_provider_id: string | null;
  selected_provider_name: string | null;
  selected_provider_email: string | null;
  accepted_price: string | null;
  swap_hash: string | null;
  originator_wallet_snapshot: string | null;
  provider_wallet_snapshot: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

interface QuoteRow {
  id: string;
  rfq_id: string;
  provider_id: string;
  provider_name: string;
  version: number;
  parent_quote_id: string | null;
  price: string;
  sell_amount: string;
  buy_amount: string;
  status: QuoteStatus;
  note: string | null;
  submitted_by_user_id: string;
  submitted_by_name: string;
  created_at: number;
  updated_at: number;
}

interface ActivityRow {
  id: string;
  rfq_id: string;
  type: ActivityType;
  actor_id: string;
  actor_name: string;
  summary: string;
  related_quote_id: string | null;
  created_at: number;
}

const rowToUser = (row: OtcUserRow): OtcUser => ({
  id: row.id,
  supabaseId: row.supabase_id,
  email: row.email,
  fullName: row.full_name,
  institutionName: row.institution_name,
  isAdmin: row.is_admin === 1,
  createdAt: row.created_at,
});

const rowToWallet = (row: UserWalletRow): UserWallet => ({
  userId: row.user_id,
  midnightCpkBytes: row.midnight_cpk_bytes,
  midnightUnshieldedBytes: row.midnight_unshielded_bytes,
  midnightCpkBech32: row.midnight_cpk_bech32,
  midnightUnshieldedBech32: row.midnight_unshielded_bech32,
  cardanoPkh: row.cardano_pkh,
  cardanoAddress: row.cardano_address,
  updatedAt: row.updated_at,
});

const rowToRfq = (row: RfqRow): Rfq => ({
  id: row.id,
  reference: row.reference,
  originatorId: row.originator_id,
  originatorName: row.originator_name,
  originatorEmail: row.originator_email,
  side: row.side,
  sellAmount: row.sell_amount,
  indicativeBuyAmount: row.indicative_buy_amount,
  status: row.status,
  selectedQuoteId: row.selected_quote_id,
  selectedProviderId: row.selected_provider_id,
  selectedProviderName: row.selected_provider_name,
  selectedProviderEmail: row.selected_provider_email,
  acceptedPrice: row.accepted_price,
  swapHash: row.swap_hash,
  originatorWalletSnapshot: row.originator_wallet_snapshot
    ? (JSON.parse(row.originator_wallet_snapshot) as UserWallet)
    : null,
  providerWalletSnapshot: row.provider_wallet_snapshot
    ? (JSON.parse(row.provider_wallet_snapshot) as UserWallet)
    : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at,
});

const rowToQuote = (row: QuoteRow): Quote => ({
  id: row.id,
  rfqId: row.rfq_id,
  providerId: row.provider_id,
  providerName: row.provider_name,
  version: row.version,
  parentQuoteId: row.parent_quote_id,
  price: row.price,
  sellAmount: row.sell_amount,
  buyAmount: row.buy_amount,
  status: row.status,
  note: row.note,
  submittedByUserId: row.submitted_by_user_id,
  submittedByName: row.submitted_by_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToActivity = (row: ActivityRow): Activity => ({
  id: row.id,
  rfqId: row.rfq_id,
  type: row.type,
  actorId: row.actor_id,
  actorName: row.actor_name,
  summary: row.summary,
  relatedQuoteId: row.related_quote_id,
  createdAt: row.created_at,
});

export class OtcError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400) {
    super(message);
    this.name = 'OtcError';
  }
}

export interface OtcStore extends SwapBridge {
  // Users
  getOrCreateUserBySupabaseId(
    supabaseId: string,
    email: string,
    fullName: string,
    institutionName: string | null,
  ): OtcUser;
  getUserById(id: string): OtcUser | undefined;
  getUserBySupabaseId(supabaseId: string): OtcUser | undefined;
  listUsers(): OtcUser[];
  setAdmin(userId: string, isAdmin: boolean): void;

  // Wallet binding
  upsertUserWallet(userId: string, input: UserWalletInput): UserWallet;
  getUserWallet(userId: string): UserWallet | undefined;

  // RFQs
  createRfq(input: CreateRfqInput): Rfq;
  listRfqs(filter?: { status?: RfqStatus; side?: RfqSide; mine?: string }): Rfq[];
  getRfq(id: string): Rfq | undefined;
  cancelRfq(id: string, actorId: string): Rfq;

  // Quotes
  listQuotes(rfqId: string): Quote[];
  submitQuote(input: SubmitQuoteInput): Quote;
  counterQuote(input: CounterQuoteInput): Quote;
  acceptQuote(rfqId: string, quoteId: string, actorId: string): Rfq;
  rejectQuote(rfqId: string, quoteId: string, actorId: string): Rfq;

  // Activity
  listActivity(rfqId: string): Activity[];
  insertActivity(
    rfqId: string,
    type: ActivityType,
    actorId: string,
    actorName: string,
    summary: string,
    relatedQuoteId?: string,
  ): Activity;
}

export const openOtcStore = (db: Database.Database): OtcStore => {
  // Schema — additive; CREATE IF NOT EXISTS so reruns are safe.
  db.exec(`
    CREATE TABLE IF NOT EXISTS otc_users (
      id               TEXT PRIMARY KEY,
      supabase_id      TEXT UNIQUE NOT NULL,
      email            TEXT UNIQUE NOT NULL,
      full_name        TEXT NOT NULL,
      institution_name TEXT,
      is_admin         INTEGER NOT NULL DEFAULT 0,
      created_at       INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_wallets (
      user_id                    TEXT PRIMARY KEY REFERENCES otc_users(id) ON DELETE CASCADE,
      midnight_cpk_bytes         TEXT NOT NULL,
      midnight_unshielded_bytes  TEXT NOT NULL,
      midnight_cpk_bech32        TEXT NOT NULL,
      midnight_unshielded_bech32 TEXT NOT NULL,
      cardano_pkh                TEXT NOT NULL,
      cardano_address            TEXT NOT NULL,
      updated_at                 INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rfqs (
      id                         TEXT PRIMARY KEY,
      reference                  TEXT UNIQUE NOT NULL,
      originator_id              TEXT NOT NULL REFERENCES otc_users(id),
      originator_name            TEXT NOT NULL,
      originator_email           TEXT NOT NULL,
      side                       TEXT NOT NULL CHECK (side IN ('sell-usdm','sell-usdc')),
      sell_amount                TEXT NOT NULL,
      indicative_buy_amount      TEXT NOT NULL,
      status                     TEXT NOT NULL CHECK (status IN (
                                   'OpenForQuotes','Negotiating','QuoteSelected',
                                   'Settling','Settled','Expired','Cancelled'
                                 )),
      selected_quote_id          TEXT,
      selected_provider_id       TEXT,
      selected_provider_name     TEXT,
      selected_provider_email    TEXT,
      accepted_price             TEXT,
      swap_hash                  TEXT,
      originator_wallet_snapshot TEXT,
      provider_wallet_snapshot   TEXT,
      created_at                 INTEGER NOT NULL,
      updated_at                 INTEGER NOT NULL,
      expires_at                 INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id                    TEXT PRIMARY KEY,
      rfq_id                TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
      provider_id           TEXT NOT NULL,
      provider_name         TEXT NOT NULL,
      version               INTEGER NOT NULL,
      parent_quote_id       TEXT,
      price                 TEXT NOT NULL,
      sell_amount           TEXT NOT NULL,
      buy_amount            TEXT NOT NULL,
      status                TEXT NOT NULL CHECK (status IN (
                              'Submitted','Countered','Accepted','Rejected','Expired'
                            )),
      note                  TEXT,
      submitted_by_user_id  TEXT NOT NULL,
      submitted_by_name     TEXT NOT NULL,
      created_at            INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id                TEXT PRIMARY KEY,
      rfq_id            TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
      type              TEXT NOT NULL,
      actor_id          TEXT NOT NULL,
      actor_name        TEXT NOT NULL,
      summary           TEXT NOT NULL,
      related_quote_id  TEXT,
      created_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rfqs_status      ON rfqs(status);
    CREATE INDEX IF NOT EXISTS idx_rfqs_originator  ON rfqs(originator_id);
    CREATE INDEX IF NOT EXISTS idx_rfqs_swap_hash   ON rfqs(swap_hash);
    CREATE INDEX IF NOT EXISTS idx_quotes_rfq       ON quotes(rfq_id);
    CREATE INDEX IF NOT EXISTS idx_quotes_provider  ON quotes(provider_id);
    CREATE INDEX IF NOT EXISTS idx_activities_rfq   ON activities(rfq_id);
  `);

  // ── Prepared statements ──
  const getUserBySupabaseStmt = db.prepare<[string], OtcUserRow>(
    'SELECT * FROM otc_users WHERE supabase_id = ?',
  );
  const getUserByIdStmt = db.prepare<[string], OtcUserRow>(
    'SELECT * FROM otc_users WHERE id = ?',
  );
  const insertUserStmt = db.prepare(`
    INSERT INTO otc_users (id, supabase_id, email, full_name, institution_name, is_admin, created_at)
    VALUES (@id, @supabase_id, @email, @full_name, @institution_name, @is_admin, @created_at)
  `);
  const updateUserMetaStmt = db.prepare(`
    UPDATE otc_users SET email = @email, full_name = @full_name, institution_name = @institution_name
    WHERE id = @id
  `);
  const listUsersStmt = db.prepare<[], OtcUserRow>(
    'SELECT * FROM otc_users ORDER BY created_at ASC',
  );
  const setAdminStmt = db.prepare<[number, string]>(
    'UPDATE otc_users SET is_admin = ? WHERE id = ?',
  );

  const getWalletStmt = db.prepare<[string], UserWalletRow>(
    'SELECT * FROM user_wallets WHERE user_id = ?',
  );
  const upsertWalletStmt = db.prepare(`
    INSERT INTO user_wallets (
      user_id, midnight_cpk_bytes, midnight_unshielded_bytes,
      midnight_cpk_bech32, midnight_unshielded_bech32,
      cardano_pkh, cardano_address, updated_at
    ) VALUES (
      @user_id, @midnight_cpk_bytes, @midnight_unshielded_bytes,
      @midnight_cpk_bech32, @midnight_unshielded_bech32,
      @cardano_pkh, @cardano_address, @updated_at
    )
    ON CONFLICT(user_id) DO UPDATE SET
      midnight_cpk_bytes         = excluded.midnight_cpk_bytes,
      midnight_unshielded_bytes  = excluded.midnight_unshielded_bytes,
      midnight_cpk_bech32        = excluded.midnight_cpk_bech32,
      midnight_unshielded_bech32 = excluded.midnight_unshielded_bech32,
      cardano_pkh                = excluded.cardano_pkh,
      cardano_address            = excluded.cardano_address,
      updated_at                 = excluded.updated_at
  `);

  const getRfqStmt = db.prepare<[string], RfqRow>('SELECT * FROM rfqs WHERE id = ?');
  const insertRfqStmt = db.prepare(`
    INSERT INTO rfqs (
      id, reference, originator_id, originator_name, originator_email,
      side, sell_amount, indicative_buy_amount, status,
      selected_quote_id, selected_provider_id, selected_provider_name, selected_provider_email,
      accepted_price, swap_hash,
      originator_wallet_snapshot, provider_wallet_snapshot,
      created_at, updated_at, expires_at
    ) VALUES (
      @id, @reference, @originator_id, @originator_name, @originator_email,
      @side, @sell_amount, @indicative_buy_amount, @status,
      NULL, NULL, NULL, NULL,
      NULL, NULL,
      NULL, NULL,
      @created_at, @updated_at, @expires_at
    )
  `);
  const listRfqsAllStmt = db.prepare<[], RfqRow>('SELECT * FROM rfqs ORDER BY created_at DESC');
  const listRfqsByStatusStmt = db.prepare<[RfqStatus], RfqRow>(
    'SELECT * FROM rfqs WHERE status = ? ORDER BY created_at DESC',
  );
  const listRfqsByOriginatorStmt = db.prepare<[string], RfqRow>(
    'SELECT * FROM rfqs WHERE originator_id = ? ORDER BY created_at DESC',
  );

  const insertActivityStmt = db.prepare(`
    INSERT INTO activities (id, rfq_id, type, actor_id, actor_name, summary, related_quote_id, created_at)
    VALUES (@id, @rfq_id, @type, @actor_id, @actor_name, @summary, @related_quote_id, @created_at)
  `);
  const getActivityStmt = db.prepare<[string], ActivityRow>(
    'SELECT * FROM activities WHERE id = ?',
  );
  const listActivityStmt = db.prepare<[string], ActivityRow>(
    'SELECT * FROM activities WHERE rfq_id = ? ORDER BY created_at ASC',
  );

  const getQuoteStmt = db.prepare<[string], QuoteRow>('SELECT * FROM quotes WHERE id = ?');
  const listQuotesStmt = db.prepare<[string], QuoteRow>(
    'SELECT * FROM quotes WHERE rfq_id = ? ORDER BY created_at ASC',
  );
  const insertQuoteStmt = db.prepare(`
    INSERT INTO quotes (
      id, rfq_id, provider_id, provider_name, version, parent_quote_id,
      price, sell_amount, buy_amount, status, note,
      submitted_by_user_id, submitted_by_name, created_at, updated_at
    ) VALUES (
      @id, @rfq_id, @provider_id, @provider_name, @version, @parent_quote_id,
      @price, @sell_amount, @buy_amount, @status, @note,
      @submitted_by_user_id, @submitted_by_name, @created_at, @updated_at
    )
  `);
  const updateQuoteStatusStmt = db.prepare<[QuoteStatus, number, string]>(
    'UPDATE quotes SET status = ?, updated_at = ? WHERE id = ?',
  );
  const updateQuotesByRfqExceptStmt = db.prepare<[QuoteStatus, number, string, string]>(
    'UPDATE quotes SET status = ?, updated_at = ? WHERE rfq_id = ? AND id != ? AND status NOT IN (\'Accepted\',\'Rejected\')',
  );
  const maxVersionForProviderStmt = db.prepare<[string, string], { v: number | null }>(
    'SELECT MAX(version) as v FROM quotes WHERE rfq_id = ? AND provider_id = ?',
  );

  // RFQ reference counter — monotonic per process. Initialized from MAX in the DB
  // so a restart picks up where we left off.
  const lastRefRow = db
    .prepare<[], { max_ref: string | null }>(
      "SELECT MAX(reference) as max_ref FROM rfqs WHERE reference LIKE 'RFQ-%'",
    )
    .get();
  let referenceCounter = 0;
  if (lastRefRow?.max_ref) {
    const m = lastRefRow.max_ref.match(/^RFQ-(\d+)$/);
    if (m) referenceCounter = Number(m[1]);
  }
  const nextReference = () => {
    referenceCounter += 1;
    return `RFQ-${String(referenceCounter).padStart(4, '0')}`;
  };

  const insertActivityImpl = (
    rfqId: string,
    type: ActivityType,
    actorId: string,
    actorName: string,
    summary: string,
    relatedQuoteId?: string,
  ): Activity => {
    const id = randomUUID();
    insertActivityStmt.run({
      id,
      rfq_id: rfqId,
      type,
      actor_id: actorId,
      actor_name: actorName,
      summary,
      related_quote_id: relatedQuoteId ?? null,
      created_at: Date.now(),
    });
    const row = getActivityStmt.get(id);
    if (!row) throw new Error('activity insert succeeded but row missing');
    return rowToActivity(row);
  };

  return {
    // ── Users ──
    getOrCreateUserBySupabaseId(supabaseId, email, fullName, institutionName) {
      const existing = getUserBySupabaseStmt.get(supabaseId);
      if (existing) {
        // Refresh metadata if Supabase updated it (e.g. user changed name).
        if (
          existing.email !== email ||
          existing.full_name !== fullName ||
          existing.institution_name !== institutionName
        ) {
          updateUserMetaStmt.run({
            id: existing.id,
            email,
            full_name: fullName,
            institution_name: institutionName,
          });
        }
        return rowToUser({
          ...existing,
          email,
          full_name: fullName,
          institution_name: institutionName,
        });
      }
      const id = randomUUID();
      insertUserStmt.run({
        id,
        supabase_id: supabaseId,
        email,
        full_name: fullName,
        institution_name: institutionName,
        is_admin: 0,
        created_at: Date.now(),
      });
      const row = getUserByIdStmt.get(id);
      if (!row) throw new Error('user insert succeeded but row missing');
      return rowToUser(row);
    },

    getUserById(id) {
      const row = getUserByIdStmt.get(id);
      return row ? rowToUser(row) : undefined;
    },

    getUserBySupabaseId(supabaseId) {
      const row = getUserBySupabaseStmt.get(supabaseId);
      return row ? rowToUser(row) : undefined;
    },

    listUsers() {
      return listUsersStmt.all().map(rowToUser);
    },

    setAdmin(userId, isAdmin) {
      setAdminStmt.run(isAdmin ? 1 : 0, userId);
    },

    // ── Wallet binding ──
    upsertUserWallet(userId, input) {
      // Validate hex / bech32 server-side. Light checks; key-encoding round-trip
      // verification happens client-side via wallet-sdk-address-format.
      const HEX64 = /^[0-9a-f]{64}$/;
      const HEX56 = /^[0-9a-f]{56}$/;
      const norm = {
        midnightCpkBytes: input.midnightCpkBytes.toLowerCase(),
        midnightUnshieldedBytes: input.midnightUnshieldedBytes.toLowerCase(),
        midnightCpkBech32: input.midnightCpkBech32,
        midnightUnshieldedBech32: input.midnightUnshieldedBech32,
        cardanoPkh: input.cardanoPkh.toLowerCase(),
        cardanoAddress: input.cardanoAddress,
      };
      if (!HEX64.test(norm.midnightCpkBytes)) {
        throw new OtcError('invalid_wallet', 'midnightCpkBytes must be 64 lowercase hex chars');
      }
      if (!HEX64.test(norm.midnightUnshieldedBytes)) {
        throw new OtcError(
          'invalid_wallet',
          'midnightUnshieldedBytes must be 64 lowercase hex chars',
        );
      }
      if (!HEX56.test(norm.cardanoPkh)) {
        throw new OtcError('invalid_wallet', 'cardanoPkh must be 56 lowercase hex chars');
      }
      if (!norm.midnightCpkBech32.startsWith('mn_shield-cpk_')) {
        throw new OtcError('invalid_wallet', 'midnightCpkBech32 must start with mn_shield-cpk_');
      }
      if (!norm.midnightUnshieldedBech32.startsWith('mn_addr_')) {
        throw new OtcError(
          'invalid_wallet',
          'midnightUnshieldedBech32 must start with mn_addr_',
        );
      }
      if (!norm.cardanoAddress.startsWith('addr')) {
        throw new OtcError('invalid_wallet', 'cardanoAddress must start with addr');
      }

      upsertWalletStmt.run({
        user_id: userId,
        midnight_cpk_bytes: norm.midnightCpkBytes,
        midnight_unshielded_bytes: norm.midnightUnshieldedBytes,
        midnight_cpk_bech32: norm.midnightCpkBech32,
        midnight_unshielded_bech32: norm.midnightUnshieldedBech32,
        cardano_pkh: norm.cardanoPkh,
        cardano_address: norm.cardanoAddress,
        updated_at: Date.now(),
      });
      const row = getWalletStmt.get(userId);
      if (!row) throw new Error('wallet upsert succeeded but row missing');
      return rowToWallet(row);
    },

    getUserWallet(userId) {
      const row = getWalletStmt.get(userId);
      return row ? rowToWallet(row) : undefined;
    },

    // ── RFQs ──
    createRfq(input) {
      const originator = this.getUserById(input.originatorId);
      if (!originator) throw new OtcError('not_found', 'originator not found', 404);
      if (!this.getUserWallet(input.originatorId)) {
        throw new OtcError(
          'wallets_missing',
          'connect both wallets before posting an RFQ',
          409,
        );
      }
      const id = randomUUID();
      const now = Date.now();
      const reference = nextReference();
      insertRfqStmt.run({
        id,
        reference,
        originator_id: originator.id,
        originator_name: originator.fullName,
        originator_email: originator.email,
        side: input.side,
        sell_amount: input.sellAmount,
        indicative_buy_amount: input.indicativeBuyAmount,
        status: 'OpenForQuotes' as RfqStatus,
        created_at: now,
        updated_at: now,
        expires_at: now + input.expiresInSeconds * 1000,
      });
      insertActivityImpl(
        id,
        'RFQ_CREATED',
        originator.id,
        originator.fullName,
        `Posted ${input.side === 'sell-usdm' ? 'USDM→USDC' : 'USDC→USDM'} order ${reference}`,
      );
      const row = getRfqStmt.get(id);
      if (!row) throw new Error('rfq insert succeeded but row missing');
      return rowToRfq(row);
    },

    listRfqs(filter) {
      let rows: RfqRow[];
      if (filter?.mine) {
        rows = listRfqsByOriginatorStmt.all(filter.mine);
      } else if (filter?.status) {
        rows = listRfqsByStatusStmt.all(filter.status);
      } else {
        rows = listRfqsAllStmt.all();
      }
      // Server-side side filter (small N; no need for an extra index).
      const filtered = filter?.side ? rows.filter((r) => r.side === filter.side) : rows;
      return filtered.map(rowToRfq);
    },

    getRfq(id) {
      const row = getRfqStmt.get(id);
      return row ? rowToRfq(row) : undefined;
    },

    cancelRfq(id, actorId) {
      const rfq = this.getRfq(id);
      if (!rfq) throw new OtcError('not_found', 'rfq not found', 404);
      if (rfq.originatorId !== actorId) {
        throw new OtcError('forbidden', 'only the originator can cancel an RFQ', 403);
      }
      if (!['OpenForQuotes', 'Negotiating'].includes(rfq.status)) {
        throw new OtcError('invalid_state', `cannot cancel an RFQ in state ${rfq.status}`, 409);
      }
      db.prepare<[number, string]>(
        "UPDATE rfqs SET status = 'Cancelled', updated_at = ? WHERE id = ?",
      ).run(Date.now(), id);
      insertActivityImpl(id, 'RFQ_CANCELLED', actorId, rfq.originatorName, 'Order cancelled');
      const updated = this.getRfq(id);
      if (!updated) throw new Error('rfq missing after cancel');
      return updated;
    },

    // ── Quotes ──
    listQuotes(rfqId) {
      return listQuotesStmt.all(rfqId).map(rowToQuote);
    },

    submitQuote(input) {
      const rfq = this.getRfq(input.rfqId);
      if (!rfq) throw new OtcError('not_found', 'rfq not found', 404);
      if (!['OpenForQuotes', 'Negotiating'].includes(rfq.status)) {
        throw new OtcError('invalid_state', `cannot quote an RFQ in state ${rfq.status}`, 409);
      }
      if (rfq.originatorId === input.providerId) {
        throw new OtcError('forbidden', 'you cannot quote your own RFQ', 403);
      }
      const provider = this.getUserById(input.providerId);
      if (!provider) throw new OtcError('not_found', 'provider not found', 404);
      if (!this.getUserWallet(input.providerId)) {
        throw new OtcError('wallets_missing', 'connect both wallets before quoting', 409);
      }

      const id = randomUUID();
      const now = Date.now();
      const prior = maxVersionForProviderStmt.get(input.rfqId, input.providerId);
      const version = (prior?.v ?? 0) + 1;

      insertQuoteStmt.run({
        id,
        rfq_id: input.rfqId,
        provider_id: provider.id,
        provider_name: provider.fullName,
        version,
        parent_quote_id: null,
        price: input.price,
        sell_amount: rfq.sellAmount,
        buy_amount: input.buyAmount,
        status: 'Submitted' as QuoteStatus,
        note: input.note ?? null,
        submitted_by_user_id: provider.id,
        submitted_by_name: provider.fullName,
        created_at: now,
        updated_at: now,
      });

      // Status nudges to Negotiating once we have any quote activity.
      if (rfq.status === 'OpenForQuotes') {
        db.prepare<[number, string]>(
          "UPDATE rfqs SET status = 'Negotiating', updated_at = ? WHERE id = ?",
        ).run(now, input.rfqId);
      }
      insertActivityImpl(
        input.rfqId,
        'QUOTE_SUBMITTED',
        provider.id,
        provider.fullName,
        `Submitted quote @ ${input.price}`,
        id,
      );
      const row = getQuoteStmt.get(id);
      if (!row) throw new Error('quote insert succeeded but row missing');
      return rowToQuote(row);
    },

    counterQuote(input) {
      const rfq = this.getRfq(input.rfqId);
      if (!rfq) throw new OtcError('not_found', 'rfq not found', 404);
      if (!['OpenForQuotes', 'Negotiating'].includes(rfq.status)) {
        throw new OtcError(
          'invalid_state',
          `cannot counter on an RFQ in state ${rfq.status}`,
          409,
        );
      }
      const parent = getQuoteStmt.get(input.parentQuoteId);
      if (!parent || parent.rfq_id !== input.rfqId) {
        throw new OtcError('not_found', 'parent quote not found', 404);
      }
      const actor = this.getUserById(input.actorId);
      if (!actor) throw new OtcError('not_found', 'actor not found', 404);
      // Counter: either the originator OR the original quoter (provider) on
      // this thread. Both sides can keep the dance going.
      if (actor.id !== rfq.originatorId && actor.id !== parent.provider_id) {
        throw new OtcError(
          'forbidden',
          'only the originator or the quoter on this thread can counter',
          403,
        );
      }
      if (!this.getUserWallet(actor.id)) {
        throw new OtcError('wallets_missing', 'connect both wallets before countering', 409);
      }

      const now = Date.now();
      // Mark parent Countered.
      updateQuoteStatusStmt.run('Countered' as QuoteStatus, now, parent.id);

      const id = randomUUID();
      insertQuoteStmt.run({
        id,
        rfq_id: input.rfqId,
        provider_id: parent.provider_id,
        provider_name: parent.provider_name,
        version: parent.version + 1,
        parent_quote_id: parent.id,
        price: input.price,
        sell_amount: rfq.sellAmount,
        buy_amount: input.buyAmount,
        status: 'Submitted' as QuoteStatus,
        note: input.note ?? null,
        submitted_by_user_id: actor.id,
        submitted_by_name: actor.fullName,
        created_at: now,
        updated_at: now,
      });

      if (rfq.status === 'OpenForQuotes') {
        db.prepare<[number, string]>(
          "UPDATE rfqs SET status = 'Negotiating', updated_at = ? WHERE id = ?",
        ).run(now, input.rfqId);
      }
      insertActivityImpl(
        input.rfqId,
        'QUOTE_COUNTERED',
        actor.id,
        actor.fullName,
        `Countered @ ${input.price}`,
        id,
      );
      const row = getQuoteStmt.get(id);
      if (!row) throw new Error('quote insert succeeded but row missing');
      return rowToQuote(row);
    },

    acceptQuote(rfqId, quoteId, actorId) {
      const rfq = this.getRfq(rfqId);
      if (!rfq) throw new OtcError('not_found', 'rfq not found', 404);
      if (rfq.originatorId !== actorId) {
        throw new OtcError('forbidden', 'only the originator can accept a quote', 403);
      }
      const quote = getQuoteStmt.get(quoteId);
      if (!quote || quote.rfq_id !== rfqId) {
        throw new OtcError('not_found', 'quote not found', 404);
      }

      const originatorWallet = this.getUserWallet(rfq.originatorId);
      const providerWallet = this.getUserWallet(quote.provider_id);
      const missing: string[] = [];
      if (!originatorWallet) missing.push('originator');
      if (!providerWallet) missing.push('counterparty');
      if (missing.length > 0) {
        throw new OtcError(
          'wallets_missing',
          `wallets not bound: ${missing.join(', ')}`,
          409,
        );
      }

      const now = Date.now();
      const txn = db.transaction(() => {
        // WHERE-guarded transition defeats double-accept races. If 0 rows
        // changed, another tab beat us — surface 409.
        const updateRfq = db
          .prepare<{ now: number; quote_id: string; provider_id: string; provider_name: string; provider_email: string; price: string; originator_snap: string; provider_snap: string; rfq_id: string }>(`
            UPDATE rfqs SET
              status = 'QuoteSelected',
              selected_quote_id = @quote_id,
              selected_provider_id = @provider_id,
              selected_provider_name = @provider_name,
              selected_provider_email = @provider_email,
              accepted_price = @price,
              originator_wallet_snapshot = @originator_snap,
              provider_wallet_snapshot = @provider_snap,
              updated_at = @now
            WHERE id = @rfq_id AND status IN ('OpenForQuotes','Negotiating')
          `)
          .run({
            now,
            rfq_id: rfqId,
            quote_id: quoteId,
            provider_id: quote.provider_id,
            provider_name: quote.provider_name,
            provider_email: this.getUserById(quote.provider_id)?.email ?? '',
            price: quote.price,
            originator_snap: JSON.stringify(originatorWallet),
            provider_snap: JSON.stringify(providerWallet),
          });
        if (updateRfq.changes === 0) {
          throw new OtcError(
            'invalid_state',
            'RFQ no longer accepts quotes (already selected or cancelled)',
            409,
          );
        }
        updateQuoteStatusStmt.run('Accepted' as QuoteStatus, now, quoteId);
        updateQuotesByRfqExceptStmt.run('Rejected' as QuoteStatus, now, rfqId, quoteId);
      });
      txn();

      insertActivityImpl(
        rfqId,
        'QUOTE_ACCEPTED',
        actorId,
        rfq.originatorName,
        `Accepted quote from ${quote.provider_name} @ ${quote.price}`,
        quoteId,
      );
      const updated = this.getRfq(rfqId);
      if (!updated) throw new Error('rfq missing after accept');
      return updated;
    },

    rejectQuote(rfqId, quoteId, actorId) {
      const rfq = this.getRfq(rfqId);
      if (!rfq) throw new OtcError('not_found', 'rfq not found', 404);
      if (rfq.originatorId !== actorId) {
        throw new OtcError('forbidden', 'only the originator can reject a quote', 403);
      }
      const quote = getQuoteStmt.get(quoteId);
      if (!quote || quote.rfq_id !== rfqId) {
        throw new OtcError('not_found', 'quote not found', 404);
      }
      updateQuoteStatusStmt.run('Rejected' as QuoteStatus, Date.now(), quoteId);
      insertActivityImpl(
        rfqId,
        'QUOTE_REJECTED',
        actorId,
        rfq.originatorName,
        `Rejected quote from ${quote.provider_name}`,
        quoteId,
      );
      const updated = this.getRfq(rfqId);
      if (!updated) throw new Error('rfq missing after reject');
      return updated;
    },

    // ── Activity ──
    listActivity(rfqId) {
      return listActivityStmt.all(rfqId).map(rowToActivity);
    },

    insertActivity(rfqId, type, actorId, actorName, summary, relatedQuoteId) {
      return insertActivityImpl(rfqId, type, actorId, actorName, summary, relatedQuoteId);
    },

    // ── SwapBridge (called by openSwapStore) ──
    linkSwapToRfq(rfqId, swapHash) {
      const rfq = getRfqStmt.get(rfqId);
      if (!rfq) {
        // RFQ was deleted between accept and lock — orphaned swap, log and proceed.
        console.warn('[bridge] linkSwapToRfq: rfq not found', { rfqId, swapHash });
        return;
      }
      const now = Date.now();
      db.prepare<[string, number, string]>(
        "UPDATE rfqs SET swap_hash = ?, status = 'Settling', updated_at = ? WHERE id = ?",
      ).run(swapHash, now, rfqId);
      insertActivityImpl(
        rfqId,
        'SETTLEMENT_STARTED',
        'system',
        'system',
        `Swap ${swapHash.slice(0, 12)}… submitted on-chain by maker.`,
      );
    },

    markRfqSettled(rfqId, swapHash) {
      const rfq = getRfqStmt.get(rfqId);
      if (!rfq) return;
      // Don't regress from a terminal state.
      if (rfq.status === 'Settled') return;
      const now = Date.now();
      db.prepare<[number, string]>(
        "UPDATE rfqs SET status = 'Settled', updated_at = ? WHERE id = ?",
      ).run(now, rfqId);
      insertActivityImpl(
        rfqId,
        'SETTLEMENT_COMPLETED',
        'system',
        'system',
        `Atomic swap ${swapHash.slice(0, 12)}… completed.`,
      );
    },
  };
};
