/**
 * Periodic scanner that finds stuck / abandoned swaps and fires webhook alerts.
 *
 * "Stuck" = a swap whose state machine has stalled past a deadline and needs
 * human (reclaim) intervention, OR an intermediate state that's been pending
 * for too long. The watchers in this orchestrator only flip status on positive
 * on-chain evidence; this module highlights swaps that will never advance
 * without someone pressing a button.
 *
 * Alerts are POSTed as JSON to STUCK_SWAP_WEBHOOK_URL. Slack and Discord
 * incoming-webhook URLs are auto-detected and wrapped in their native payload
 * format (`{ text }` / `{ content }`) — otherwise we send a raw JSON object.
 *
 * An in-memory dedupe map ensures we don't spam the channel: once a swap has
 * been alerted for a given reason, we re-alert only after `reAlertMs` has
 * passed (default 6h).
 */

import type { FastifyBaseLogger } from 'fastify';
import type { SwapStore } from './db.js';
import type { Swap, SwapStatus } from './types.js';

export type StuckReason =
  | 'alice_reclaim_available'
  | 'bob_reclaim_available'
  | 'alice_claim_stalled';

interface AlertKey {
  hash: string;
  reason: StuckReason;
}

export interface StuckAlerterConfig {
  webhookUrl: string;
  scanIntervalMs: number;
  aliceClaimedStaleMs: number;
  reAlertMs: number;
  publicBaseUrl?: string;
}

export interface StuckAlerter {
  stop(): void;
}

export const resolveStuckAlerterConfig = (
  logger: FastifyBaseLogger,
): StuckAlerterConfig | null => {
  const webhookUrl = process.env.STUCK_SWAP_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    logger.info('stuck-alerter disabled: set STUCK_SWAP_WEBHOOK_URL to enable');
    return null;
  }

  const scanIntervalMs = Number(process.env.STUCK_SWAP_SCAN_INTERVAL_MS ?? 60_000);
  const aliceClaimedStaleMs = Number(
    process.env.STUCK_SWAP_ALICE_CLAIMED_STALE_MS ?? 15 * 60_000,
  );
  const reAlertMs = Number(process.env.STUCK_SWAP_REALERT_MS ?? 6 * 60 * 60_000);

  return {
    webhookUrl,
    scanIntervalMs: Number.isFinite(scanIntervalMs) && scanIntervalMs >= 10_000
      ? scanIntervalMs
      : 60_000,
    aliceClaimedStaleMs:
      Number.isFinite(aliceClaimedStaleMs) && aliceClaimedStaleMs >= 60_000
        ? aliceClaimedStaleMs
        : 15 * 60_000,
    reAlertMs: Number.isFinite(reAlertMs) && reAlertMs >= 60_000 ? reAlertMs : 6 * 60 * 60_000,
    publicBaseUrl: process.env.STUCK_SWAP_PUBLIC_UI_URL?.trim() || undefined,
  };
};

const classify = (swap: Swap, now: number, aliceClaimedStaleMs: number): StuckReason | null => {
  const cardanoExpired = swap.cardanoDeadlineMs !== null && swap.cardanoDeadlineMs <= now;
  const midnightExpired = swap.midnightDeadlineMs !== null && swap.midnightDeadlineMs <= now;

  // Direction-aware: whose refund matters when changes depending on who locked
  // which chain.
  //
  //   ada-usdc: maker locked Cardano (alice_reclaim on cardanoExpired);
  //             taker deposited Midnight (bob_reclaim on midnightExpired).
  //   usdc-ada: maker deposited Midnight (alice_reclaim on midnightExpired);
  //             taker locked Cardano (bob_reclaim on cardanoExpired).

  if (swap.direction === 'usdm-usdc') {
    if (swap.status === 'bob_deposited' && midnightExpired) return 'bob_reclaim_available';
    if ((swap.status === 'open' || swap.status === 'bob_deposited') && cardanoExpired) {
      return 'alice_reclaim_available';
    }
  } else {
    if (swap.status === 'bob_deposited' && cardanoExpired) return 'bob_reclaim_available';
    if ((swap.status === 'open' || swap.status === 'bob_deposited') && midnightExpired) {
      return 'alice_reclaim_available';
    }
  }

  if (swap.status === 'alice_claimed') {
    if (now - swap.updatedAt > aliceClaimedStaleMs) {
      return 'alice_claim_stalled';
    }
  }

  return null;
};

const humanReason = (reason: StuckReason): string => {
  switch (reason) {
    case 'alice_reclaim_available':
      return 'Cardano deadline passed — Alice can reclaim ADA';
    case 'bob_reclaim_available':
      return 'Midnight deadline passed — Bob can reclaim USDC';
    case 'alice_claim_stalled':
      return 'Alice claimed USDC > 15min ago but Bob has not claimed ADA';
  }
};

const amountSummary = (swap: Swap): string => {
  const parts: string[] = [];
  if (swap.usdmAmount) parts.push(`${swap.usdmAmount} ADA`);
  if (swap.usdcAmount) parts.push(`${swap.usdcAmount} USDC`);
  return parts.join(' ⇄ ');
};

interface AlertPayload {
  hash: string;
  shortHash: string;
  status: SwapStatus;
  reason: StuckReason;
  reasonLabel: string;
  amountSummary: string;
  usdmAmount: string;
  usdcAmount: string;
  cardanoDeadlineMs: number | null;
  midnightDeadlineMs: number | null;
  updatedAt: number;
  createdAt: number;
  timestamp: number;
  ageSecs: number;
  reclaimUrl?: string;
}

const buildPayload = (
  swap: Swap,
  reason: StuckReason,
  cfg: StuckAlerterConfig,
): AlertPayload => {
  const now = Date.now();
  return {
    hash: swap.hash,
    shortHash: swap.hash.slice(0, 16),
    status: swap.status,
    reason,
    reasonLabel: humanReason(reason),
    amountSummary: amountSummary(swap),
    usdmAmount: swap.usdmAmount,
    usdcAmount: swap.usdcAmount,
    cardanoDeadlineMs: swap.cardanoDeadlineMs,
    midnightDeadlineMs: swap.midnightDeadlineMs,
    updatedAt: swap.updatedAt,
    createdAt: swap.createdAt,
    timestamp: now,
    ageSecs: Math.floor((now - swap.createdAt) / 1000),
    reclaimUrl: cfg.publicBaseUrl ? `${cfg.publicBaseUrl.replace(/\/$/, '')}/reclaim` : undefined,
  };
};

const isSlackUrl = (url: string): boolean =>
  /hooks\.slack\.com\//.test(url) || /slack\.com\/services\//.test(url);

const isDiscordUrl = (url: string): boolean =>
  /discord(?:app)?\.com\/api\/webhooks\//.test(url);

const formatMessageLine = (payload: AlertPayload): string => {
  const lines: string[] = [
    `⚠ Stuck swap \`${payload.shortHash}…\` (${payload.status})`,
    `${payload.reasonLabel}`,
    `${payload.amountSummary}`,
  ];
  if (payload.cardanoDeadlineMs) {
    lines.push(`Cardano deadline: ${new Date(payload.cardanoDeadlineMs).toISOString()}`);
  }
  if (payload.midnightDeadlineMs) {
    lines.push(`Midnight deadline: ${new Date(payload.midnightDeadlineMs).toISOString()}`);
  }
  if (payload.reclaimUrl) {
    lines.push(`Reclaim: ${payload.reclaimUrl}`);
  }
  return lines.join('\n');
};

const wrapForTarget = (url: string, payload: AlertPayload): unknown => {
  const msg = formatMessageLine(payload);
  if (isSlackUrl(url)) {
    return { text: msg };
  }
  if (isDiscordUrl(url)) {
    return { content: msg };
  }
  return payload;
};

const keyOf = ({ hash, reason }: AlertKey): string => `${hash}:${reason}`;

export const startStuckAlerter = (
  store: SwapStore,
  cfg: StuckAlerterConfig,
  logger: FastifyBaseLogger,
): StuckAlerter => {
  const lastSent = new Map<string, number>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const send = async (payload: AlertPayload): Promise<boolean> => {
    const body = wrapForTarget(cfg.webhookUrl, payload);
    try {
      const res = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.warn(
          { status: res.status, body: text.slice(0, 200) },
          'stuck-alerter: webhook returned non-2xx',
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : err },
        'stuck-alerter: webhook POST failed',
      );
      return false;
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;

    const now = Date.now();
    const candidates = [
      ...store.list({ status: 'open' }),
      ...store.list({ status: 'bob_deposited' }),
      ...store.list({ status: 'alice_claimed' }),
    ];
    if (candidates.length === 0) return;

    for (const swap of candidates) {
      if (stopped) return;
      const reason = classify(swap, now, cfg.aliceClaimedStaleMs);
      if (!reason) continue;

      const k = keyOf({ hash: swap.hash, reason });
      const prev = lastSent.get(k);
      if (prev !== undefined && now - prev < cfg.reAlertMs) continue;

      const payload = buildPayload(swap, reason, cfg);
      const ok = await send(payload);
      if (ok) {
        lastSent.set(k, now);
        logger.info(
          { hash: payload.shortHash, reason, status: swap.status },
          'stuck-alerter: alert sent',
        );
      }
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick()
        .catch((err) => {
          logger.warn(
            { err: err instanceof Error ? err.message : err },
            'stuck-alerter: tick failed',
          );
        })
        .finally(schedule);
    }, cfg.scanIntervalMs);
  };

  logger.info(
    {
      scanIntervalMs: cfg.scanIntervalMs,
      aliceClaimedStaleMs: cfg.aliceClaimedStaleMs,
      reAlertMs: cfg.reAlertMs,
      target: isSlackUrl(cfg.webhookUrl)
        ? 'slack'
        : isDiscordUrl(cfg.webhookUrl)
          ? 'discord'
          : 'generic',
    },
    'stuck-alerter started',
  );

  schedule();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
