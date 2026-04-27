import React from 'react';
import { Box, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

interface PanelProps {
  readonly children: React.ReactNode;
  readonly sx?: SxProps<Theme>;
}

export const Panel: React.FC<PanelProps> = ({ children, sx }) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        border: `1px solid ${theme.custom.borderSubtle}`,
        borderRadius: 2,
        bgcolor: alpha('#05070B', 0.82),
        overflow: 'hidden',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
};

interface PanelHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly children?: React.ReactNode;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({ title, subtitle, children }) => {
  const theme = useTheme();
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      alignItems={{ xs: 'stretch', sm: 'center' }}
      sx={{
        px: 2,
        py: 1.5,
        borderBottom: `1px solid ${theme.custom.borderSubtle}`,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.72rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: theme.custom.textPrimary,
          }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography
            sx={{
              mt: 0.35,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.64rem',
              color: theme.custom.textMuted,
            }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
      {children && (
        <Stack direction="row" spacing={1} alignItems="center" justifyContent={{ xs: 'stretch', sm: 'flex-end' }}>
          {children}
        </Stack>
      )}
    </Stack>
  );
};
