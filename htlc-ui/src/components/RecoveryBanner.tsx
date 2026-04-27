/**
 * Global recovery banner — renders at the top of every page when the user's
 * connected wallets have reclaimable stuck swaps (deadline passed, funds
 * recoverable).
 *
 * Quiet when there's nothing to do; prominent (warning) when action is needed.
 * One click takes the user straight to /reclaim where the list-driven UI
 * handles it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSwapContext } from '../hooks';
import { orchestratorClient, type Swap } from '../api/orchestrator-client';

export const RecoveryBanner: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, cardano } = useSwapContext();
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());

  const myCpk = session?.bootstrap.coinPublicKeyHex?.toLowerCase();
  const myPkh = cardano?.paymentKeyHash?.toLowerCase();

  useEffect(() => {
    if (!myCpk && !myPkh) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const { swaps: list } = await orchestratorClient.listSwaps();
        if (!cancelled) setSwaps(list);
      } catch {
        /* orchestrator is optional — ignore unreachable */
      }
    };
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [myCpk, myPkh]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const { usdmCount, usdcCount } = useMemo(() => {
    let usdm = 0;
    let usdc = 0;
    const isCpkMine = (c: string | null | undefined): boolean => !!myCpk && c?.toLowerCase() === myCpk;
    const isPkhMine = (p: string | null | undefined): boolean => !!myPkh && p?.toLowerCase() === myPkh;
    const cardanoExpired = (s: Swap): boolean => s.cardanoDeadlineMs !== null && s.cardanoDeadlineMs < nowMs;
    const midnightExpired = (s: Swap): boolean => s.midnightDeadlineMs !== null && s.midnightDeadlineMs < nowMs;

    for (const s of swaps) {
      if (s.direction === 'usdm-usdc') {
        // forward: maker locks USDM (aliceCpk); taker deposits USDC (bobCpk).
        if (isCpkMine(s.aliceCpk) && (s.status === 'open' || s.status === 'bob_deposited') && cardanoExpired(s)) {
          usdm++;
        }
        if (isCpkMine(s.bobCpk) && s.status === 'bob_deposited' && midnightExpired(s)) {
          usdc++;
        }
      } else {
        // reverse: maker deposits USDC (aliceCpk); taker locks USDM (bobPkh).
        if (isCpkMine(s.aliceCpk) && (s.status === 'open' || s.status === 'bob_deposited') && midnightExpired(s)) {
          usdc++;
        }
        if (isPkhMine(s.bobPkh) && s.status === 'bob_deposited' && cardanoExpired(s)) {
          usdm++;
        }
      }
    }
    return { usdmCount: usdm, usdcCount: usdc };
  }, [swaps, nowMs, myCpk, myPkh]);

  const total = usdmCount + usdcCount;
  if (total === 0) return null;
  if (location.pathname === '/reclaim') return null;

  const parts: string[] = [];
  if (usdmCount > 0) parts.push(`${usdmCount} USDM lock${usdmCount === 1 ? '' : 's'}`);
  if (usdcCount > 0) parts.push(`${usdcCount} USDC deposit${usdcCount === 1 ? '' : 's'}`);

  return (
    <Alert
      severity="warning"
      icon={<WarningAmberIcon />}
      sx={{ mb: 2 }}
      action={
        <Button size="small" color="warning" variant="contained" onClick={() => navigate('/reclaim')}>
          Go to Reclaim
        </Button>
      }
    >
      You have {parts.join(' and ')} past their deadline — reclaim now to recover funds.
    </Alert>
  );
};
