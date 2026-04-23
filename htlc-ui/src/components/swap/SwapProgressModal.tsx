/**
 * Modal that drives the multi-step swap flow once the user has clicked the
 * primary CTA. Shows a vertical stepper for each phase, highlights the one
 * currently running, and surfaces any per-phase action (the share URL for
 * the maker flow, the "claim" CTAs on either side).
 */

import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { alpha, useTheme } from '@mui/material/styles';
import type { MakerStep } from './useMakerFlow';
import type { TakerStep } from './useTakerFlow';
import { AsyncButton } from '../AsyncButton';
import { ShareUrlCard } from '../ShareUrlCard';
import { describeBobWindow, limits } from '../../config/limits';
import type { TokenMeta } from './tokens';
import { TokenBadge } from './TokenBadge';

type Mode =
  | {
      variant: 'maker';
      state: MakerStep;
      shareUrl: string | undefined;
      onClaim: () => void | Promise<void>;
      onReset: () => void;
    }
  | {
      variant: 'taker';
      state: TakerStep;
      onAccept: () => void;
      onClaim: () => void | Promise<void>;
      onReset: () => void;
      usdcColor: string;
    };

type Props = Mode & {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly pay: TokenMeta;
  readonly receive: TokenMeta;
};

type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface PhaseRow {
  id: string;
  title: string;
  subtitle?: React.ReactNode;
  status: StepStatus;
  action?: React.ReactNode;
}

const TX_SCAN_BASE = {
  midnight: 'https://indexer.preprod.midnight.network/tx/',
  cardano: 'https://preprod.cardanoscan.io/transaction/',
};

const txLink = (chain: 'midnight' | 'cardano', hash: string): React.ReactNode => (
  <Link href={`${TX_SCAN_BASE[chain]}${hash}`} target="_blank" rel="noopener" sx={{ fontSize: 12 }}>
    <code style={{ fontSize: 12 }}>
      {hash.slice(0, 8)}…{hash.slice(-6)}
    </code>{' '}
    <OpenInNewIcon fontSize="inherit" sx={{ verticalAlign: 'text-bottom' }} />
  </Link>
);

const buildMakerPhases = (
  state: MakerStep,
  shareUrl: string | undefined,
  onClaim: () => void | Promise<void>,
): PhaseRow[] => {
  const hasLockInfo =
    state.kind === 'locked' ||
    state.kind === 'waiting-deposit' ||
    state.kind === 'claim-ready' ||
    state.kind === 'claiming';
  const afterLock = hasLockInfo || state.kind === 'done';
  const afterDeposit = state.kind === 'claim-ready' || state.kind === 'claiming' || state.kind === 'done';
  const afterClaim = state.kind === 'done';

  let lockSubtitle: React.ReactNode;
  if (state.kind === 'locking') {
    lockSubtitle = 'Please sign in your Cardano wallet.';
  } else if (hasLockInfo) {
    lockSubtitle = (
      <Stack spacing={0.25}>
        <Typography variant="caption">
          Locked until {new Date(Number(state.deadlineMs)).toLocaleString()}
        </Typography>
        <Typography variant="caption">Lock tx: {txLink('cardano', state.lockTxHash)}</Typography>
      </Stack>
    );
  } else if (state.kind === 'done') {
    lockSubtitle = (
      <Typography variant="caption">Lock tx: {txLink('cardano', state.lockTxHash)}</Typography>
    );
  }

  return [
    {
      id: 'lock',
      title: 'Lock ADA on Cardano',
      subtitle: lockSubtitle,
      status:
        state.kind === 'locking'
          ? 'active'
          : afterLock
            ? 'done'
            : state.kind === 'error'
              ? 'error'
              : 'pending',
    },
    {
      id: 'share',
      title: 'Share the offer',
      subtitle: afterLock && shareUrl
        ? 'The counterparty opens this URL (or scans the QR) to accept. Once they deposit, this step is done.'
        : 'Waiting for lock confirmation…',
      status: afterDeposit ? 'done' : afterLock && shareUrl ? 'active' : 'pending',
      action: afterLock && shareUrl && !afterDeposit ? <ShareUrlCard shareUrl={shareUrl} title="Share the offer URL" /> : undefined,
    },
    {
      id: 'claim',
      title: 'Claim USDC on Midnight',
      subtitle: afterClaim
        ? `Received ${state.kind === 'done' ? state.depositAmount.toString() : ''} USDC.`
        : afterDeposit
          ? 'Counterparty deposited — you can claim now. Claiming reveals the preimage so they can finish on Cardano.'
          : 'Waits for the counterparty deposit to appear on Midnight.',
      status:
        state.kind === 'claiming'
          ? 'active'
          : afterClaim
            ? 'done'
            : afterDeposit
              ? 'active'
              : 'pending',
      action:
        state.kind === 'claim-ready' ? (
          <AsyncButton variant="contained" color="primary" size="large" onClick={onClaim} pendingLabel="Signing…">
            Claim USDC
          </AsyncButton>
        ) : undefined,
    },
  ];
};

const buildTakerPhases = (state: TakerStep, onAccept: () => void, onClaim: () => void | Promise<void>, usdcColor: string): PhaseRow[] => {
  const afterWatch = state.kind === 'confirm' || state.kind === 'depositing' || state.kind === 'waiting-preimage' ||
    state.kind === 'claim-ready' || state.kind === 'claiming' || state.kind === 'done';
  const afterDeposit = state.kind === 'waiting-preimage' || state.kind === 'claim-ready' ||
    state.kind === 'claiming' || state.kind === 'done';
  const afterPreimage = state.kind === 'claim-ready' || state.kind === 'claiming' || state.kind === 'done';
  const afterClaim = state.kind === 'done';

  return [
    {
      id: 'watch',
      title: 'Verify the maker’s ADA lock',
      subtitle:
        state.kind === 'watching-cardano'
          ? 'Scanning Cardano for the lock bound to your wallet…'
          : afterWatch
            ? `Found: ${(Number((state as Extract<TakerStep, { htlcInfo: unknown }>).htlcInfo.amountLovelace) / 1e6).toFixed(6)} ADA locked.`
            : state.kind === 'unsafe-deadline'
              ? state.reason
              : 'Waiting for wallet connection.',
      status:
        state.kind === 'watching-cardano'
          ? 'active'
          : afterWatch
            ? 'done'
            : state.kind === 'unsafe-deadline' || state.kind === 'error'
              ? 'error'
              : 'pending',
    },
    {
      id: 'deposit',
      title: 'Deposit USDC on Midnight',
      subtitle: afterDeposit
        ? 'Deposited. Your USDC is escrowed until the maker claims or your deadline passes.'
        : state.kind === 'depositing'
          ? 'Sign in your Midnight wallet.'
          : state.kind === 'confirm'
            ? describeBobWindow(Number(state.htlcInfo.deadlineMs), Number(state.bobDeadlineSecs))
            : 'Waiting for verification.',
      status:
        state.kind === 'depositing'
          ? 'active'
          : afterDeposit
            ? 'done'
            : state.kind === 'confirm'
              ? 'active'
              : 'pending',
      action:
        state.kind === 'confirm' ? (
          <Stack spacing={1}>
            {state.truncated && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Midnight deadline truncated to stay {Math.round(limits.bobSafetyBufferSecs / 60)}min inside the Cardano window.
              </Alert>
            )}
            <AsyncButton variant="contained" color="primary" size="large" onClick={onAccept} pendingLabel="Preparing…">
              Accept offer & deposit {state.url.usdcAmount.toString()} USDC
            </AsyncButton>
            <Typography variant="caption" sx={{ color: (t) => t.custom.textMuted }}>
              USDC color {usdcColor.slice(0, 16)}…
            </Typography>
          </Stack>
        ) : undefined,
    },
    {
      id: 'preimage',
      title: 'Wait for the maker to reveal',
      subtitle: afterPreimage
        ? 'Preimage on-chain. Use it to spend the Cardano lock.'
        : afterDeposit
          ? 'Usually resolves within seconds once the maker claims their USDC.'
          : 'Pending.',
      status: state.kind === 'waiting-preimage' ? 'active' : afterPreimage ? 'done' : 'pending',
    },
    {
      id: 'claim',
      title: 'Claim ADA on Cardano',
      subtitle: afterClaim
        ? `Received ${(Number(state.htlcInfo.amountLovelace) / 1e6).toFixed(6)} ADA. Claim tx ${txLink('cardano', state.claimTxHash)}.`
        : afterPreimage
          ? 'Ready to claim with the revealed preimage.'
          : 'Pending.',
      status: state.kind === 'claiming' ? 'active' : afterClaim ? 'done' : afterPreimage ? 'active' : 'pending',
      action:
        state.kind === 'claim-ready' ? (
          <AsyncButton variant="contained" color="primary" size="large" onClick={onClaim} pendingLabel="Signing…">
            Claim ADA
          </AsyncButton>
        ) : undefined,
    },
  ];
};

const PhaseIcon: React.FC<{ status: StepStatus }> = ({ status }) => {
  const theme = useTheme();
  if (status === 'done')
    return <CheckCircleIcon fontSize="small" sx={{ color: theme.custom.success }} />;
  if (status === 'error')
    return <ErrorOutlineIcon fontSize="small" sx={{ color: theme.custom.danger }} />;
  if (status === 'active')
    return <CircularProgress size={16} thickness={5} sx={{ color: theme.custom.cardanoBlue }} />;
  return <RadioButtonUncheckedIcon fontSize="small" sx={{ color: theme.custom.textMuted }} />;
};

export const SwapProgressModal: React.FC<Props> = (props) => {
  const { open, onClose, pay, receive } = props;
  const theme = useTheme();

  const phases: PhaseRow[] =
    props.variant === 'maker'
      ? buildMakerPhases(props.state, props.shareUrl, props.onClaim)
      : buildTakerPhases(props.state, props.onAccept, props.onClaim, props.usdcColor);

  const isDone =
    (props.variant === 'maker' && props.state.kind === 'done') ||
    (props.variant === 'taker' && props.state.kind === 'done');
  const errorMessage =
    (props.variant === 'maker' && props.state.kind === 'error' && props.state.message) ||
    (props.variant === 'taker' && props.state.kind === 'error' && props.state.message) ||
    (props.variant === 'taker' && props.state.kind === 'unsafe-deadline' && props.state.reason) ||
    undefined;

  const title = isDone
    ? 'Swap complete'
    : props.variant === 'maker'
      ? 'Making an offer'
      : 'Taking an offer';

  const subtitle = `${pay.symbol} on ${pay.chain} → ${receive.symbol} on ${receive.chain}`;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Stack direction="row" spacing={-1}>
          <TokenBadge token={pay} size={28} />
          <Box sx={{ transform: 'translateX(-6px)' }}>
            <TokenBadge token={receive} size={28} />
          </Box>
        </Stack>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '1.05rem' }}>{title}</Typography>
          <Typography variant="caption" sx={{ color: theme.custom.textMuted }}>{subtitle}</Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {errorMessage && (
            <Alert severity="error" variant="standard">
              {errorMessage}
            </Alert>
          )}

          {phases.map((phase, i) => (
            <Stack key={phase.id} direction="row" spacing={2} alignItems="flex-start">
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.5 }}>
                <PhaseIcon status={phase.status} />
                {i < phases.length - 1 && (
                  <Box
                    sx={{
                      width: 2,
                      flex: 1,
                      minHeight: 24,
                      mt: 0.5,
                      background:
                        phase.status === 'done'
                          ? alpha(theme.custom.success, 0.35)
                          : alpha('#ffffff', 0.08),
                    }}
                  />
                )}
              </Box>
              <Box sx={{ flex: 1, pb: 2 }}>
                <Typography
                  sx={{
                    fontWeight: 600,
                    color:
                      phase.status === 'pending'
                        ? theme.custom.textMuted
                        : theme.custom.textPrimary,
                  }}
                >
                  {phase.title}
                </Typography>
                {phase.subtitle && (
                  <Typography
                    variant="caption"
                    component="div"
                    sx={{ color: theme.custom.textSecondary, mt: 0.25, lineHeight: 1.45 }}
                  >
                    {phase.subtitle}
                  </Typography>
                )}
                {phase.action && <Box sx={{ mt: 1.25 }}>{phase.action}</Box>}
              </Box>
            </Stack>
          ))}

          {isDone && (
            <Box
              sx={{
                p: 2,
                borderRadius: 3,
                border: `1px solid ${alpha(theme.custom.success, 0.25)}`,
                bgcolor: alpha(theme.custom.success, 0.06),
              }}
            >
              <Typography sx={{ fontWeight: 600, color: theme.custom.success, mb: 0.5 }}>
                Funds received
              </Typography>
              {props.variant === 'maker' && props.state.kind === 'done' && (
                <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
                  Sent {props.state.adaAmount.toString()} ADA · Received {props.state.depositAmount.toString()} USDC
                </Typography>
              )}
              {props.variant === 'taker' && props.state.kind === 'done' && (
                <Typography variant="body2" sx={{ color: theme.custom.textSecondary }}>
                  Sent {props.state.url.usdcAmount.toString()} USDC · Received{' '}
                  {(Number(props.state.htlcInfo.amountLovelace) / 1e6).toFixed(6)} ADA
                </Typography>
              )}
            </Box>
          )}

          <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
            <Box sx={{ flex: 1 }} />
            {(isDone || errorMessage) && (
              <Button variant="outlined" color="primary" onClick={props.onReset}>
                Start new swap
              </Button>
            )}
            <Button variant="text" onClick={onClose}>
              {isDone ? 'Close' : 'Hide'}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
};
