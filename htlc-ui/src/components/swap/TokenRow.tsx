/**
 * Single row of the swap card — a label above, an amount input on the left,
 * and a token pill on the right. Visually matches Uniswap's input rows.
 */

import React from 'react';
import { Box, InputBase, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { TokenBadge } from './TokenBadge';
import type { TokenMeta } from './tokens';

interface Props {
  readonly label: string;
  readonly value: string;
  readonly onChange?: (v: string) => void;
  readonly token: TokenMeta;
  readonly helper?: React.ReactNode;
  readonly readOnly?: boolean;
  readonly autoFocus?: boolean;
}

export const TokenRow: React.FC<Props> = ({ label, value, onChange, token, helper, readOnly, autoFocus }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        p: '16px 18px 14px',
        borderRadius: 3,
        border: `1px solid ${theme.custom.borderSubtle}`,
        bgcolor: alpha('#ffffff', 0.015),
        transition: 'all 140ms ease',
        '&:focus-within': {
          borderColor: alpha(theme.custom.cardanoBlue, 0.45),
          bgcolor: alpha(theme.custom.cardanoBlue, 0.04),
        },
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: theme.custom.textMuted, fontSize: '0.78rem', letterSpacing: 0, fontWeight: 500 }}
      >
        {label}
      </Typography>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 0.5 }}>
        <InputBase
          value={value}
          autoFocus={autoFocus}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder="0"
          inputProps={{
            inputMode: 'decimal',
            pattern: '[0-9]*\\.?[0-9]*',
            'aria-label': label,
          }}
          sx={{
            flex: 1,
            fontSize: '2rem',
            fontWeight: 500,
            color: theme.custom.textPrimary,
            '& input': {
              padding: 0,
              '&::placeholder': { color: theme.custom.textMuted, opacity: 1 },
            },
          }}
        />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.25,
            py: 0.75,
            borderRadius: 999,
            border: `1px solid ${theme.custom.borderSubtle}`,
            bgcolor: alpha('#ffffff', 0.04),
            minWidth: 124,
          }}
        >
          <TokenBadge token={token} size={24} />
          <Stack sx={{ lineHeight: 1 }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 600, letterSpacing: 0 }}>{token.symbol}</Typography>
            <Typography
              variant="caption"
              sx={{ fontSize: '0.68rem', color: theme.custom.textMuted, lineHeight: 1 }}
            >
              on {token.chain}
            </Typography>
          </Stack>
        </Box>
      </Stack>
      {helper && (
        <Typography variant="caption" sx={{ mt: 1, display: 'block', color: theme.custom.textMuted }}>
          {helper}
        </Typography>
      )}
    </Box>
  );
};
