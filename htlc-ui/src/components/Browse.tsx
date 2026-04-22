/**
 * Bob's browsing view. Lists open swaps from the orchestrator DB so Bob can
 * take an offer without needing a shared URL.
 *
 * IMPORTANT: Each Cardano HTLC lock is bound on-chain to a specific receiver
 * PKH that Alice chose. A Bob whose Eternl PKH differs cannot claim the ADA.
 * This view surfaces that mismatch up-front — Bob must connect wallets first,
 * and offers targeting a different PKH are visibly disabled so he doesn't
 * waste time waiting on a watcher that will never fire.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate } from 'react-router-dom';
import { orchestratorClient, type Swap } from '../api/orchestrator-client';
import { useSwapContext } from '../hooks';
import { WalletConnect } from './WalletConnect';

const MIN_REMAINING_SECS = 1800;

const formatRemaining = (deadlineMs: number): string => {
  const remSecs = Math.floor((deadlineMs - Date.now()) / 1000);
  if (remSecs <= 0) return 'expired';
  const mins = Math.floor(remSecs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
};

export const Browse: React.FC = () => {
  const navigate = useNavigate();
  const { cardano, session } = useSwapContext();
  const [swaps, setSwaps] = useState<Swap[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const myPkh = cardano?.paymentKeyHash?.toLowerCase();
  const myCpk = session?.bootstrap.coinPublicKeyHex?.toLowerCase();
  const visibleSwaps = swaps?.filter((s) => !myCpk || s.aliceCpk.toLowerCase() !== myCpk);
  const ownCount = swaps && myCpk ? swaps.length - (visibleSwaps?.length ?? 0) : 0;

  const refresh = useCallback(async () => {
    setError(undefined);
    setLoading(true);
    try {
      const { swaps: list } = await orchestratorClient.listSwaps('open');
      setSwaps(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const onTakeOffer = useCallback(
    (swap: Swap) => {
      const params = new URLSearchParams({
        role: 'bob',
        hash: swap.hash,
        aliceCpk: swap.aliceCpk,
        aliceUnshielded: swap.aliceUnshielded,
        cardanoDeadlineMs: swap.cardanoDeadlineMs.toString(),
        adaAmount: swap.adaAmount,
        usdcAmount: swap.usdcAmount,
      });
      navigate(`/bob?${params.toString()}`);
    },
    [navigate],
  );

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 720 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="h4" sx={{ color: '#fff', flex: 1 }}>
          Open offers
        </Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      <Alert severity="info">
        Each offer is bound on-chain to a specific Cardano wallet (PKH). Connect your Eternl wallet below — offers
        addressed to a different PKH are disabled because the Cardano validator would reject your claim.
      </Alert>

      <WalletConnect />

      {error && (
        <Alert severity="error">
          Orchestrator unreachable: {error}
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption">
              Is the orchestrator running? <code>cd htlc-orchestrator &amp;&amp; npm run dev</code>
            </Typography>
          </Box>
        </Alert>
      )}

      {loading && !swaps && (
        <Stack direction="row" spacing={2} alignItems="center">
          <CircularProgress size={20} />
          <Typography>Loading offers…</Typography>
        </Stack>
      )}

      {ownCount > 0 && (
        <Alert severity="info">
          {ownCount === 1
            ? 'Your own open offer is hidden here — manage it on the Alice page.'
            : `${ownCount} of your own open offers are hidden here — manage them on the Alice page.`}
        </Alert>
      )}

      {visibleSwaps && visibleSwaps.length === 0 && (
        <Card>
          <CardContent>
            <Typography>No open offers right now. Come back later or ask Alice for a share URL.</Typography>
          </CardContent>
        </Card>
      )}

      {visibleSwaps?.map((swap) => {
        const remaining = swap.cardanoDeadlineMs - Date.now();
        const expired = remaining <= 0;
        const unsafe = remaining < MIN_REMAINING_SECS * 1000;
        const targetPkh = swap.bobPkh?.toLowerCase();
        const missingPkh = !targetPkh;
        const walletMismatch = !!(myPkh && targetPkh && myPkh !== targetPkh);
        const walletMatches = !!(myPkh && targetPkh && myPkh === targetPkh);
        const canTake = walletMatches && !expired && !unsafe;
        return (
          <Card key={swap.hash}>
            <CardContent>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="h6">
                    {swap.adaAmount} ADA ⇄ {swap.usdcAmount} USDC
                  </Typography>
                  {expired ? (
                    <Chip size="small" color="error" label="expired" />
                  ) : unsafe ? (
                    <Chip size="small" color="warning" label="too little time" />
                  ) : (
                    <Chip size="small" color="success" label={formatRemaining(swap.cardanoDeadlineMs)} />
                  )}
                  {walletMatches && <Chip size="small" color="success" label="for your wallet" />}
                  {walletMismatch && <Chip size="small" color="error" label="different wallet" />}
                </Stack>
                <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                  Hash: {swap.hash}
                </Typography>
                <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                  Locked to PKH: {targetPkh ?? '(unknown)'}
                </Typography>
                {myPkh && (
                  <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                    Your PKH: {myPkh}
                  </Typography>
                )}
                <Typography variant="caption">
                  Cardano deadline: {new Date(swap.cardanoDeadlineMs).toISOString()}
                </Typography>
                {walletMismatch && (
                  <Alert severity="error">
                    This offer is locked on-chain to a different Cardano wallet. Only that wallet can claim the ADA.
                    Switch Eternl accounts or ask Alice to re-post the offer with your PKH.
                  </Alert>
                )}
                {missingPkh && (
                  <Alert severity="warning">
                    Legacy offer — no intended receiver PKH recorded. Cannot verify your wallet will match. Ask Alice
                    for a share URL instead.
                  </Alert>
                )}
                <Box sx={{ mt: 1 }}>
                  <Button
                    variant="contained"
                    onClick={() => onTakeOffer(swap)}
                    disabled={!canTake}
                  >
                    {!myPkh
                      ? 'Connect Eternl to take'
                      : missingPkh
                        ? 'Cannot verify'
                        : walletMismatch
                          ? 'Not your wallet'
                          : 'Take this offer'}
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        );
      })}
    </Stack>
  );
};
