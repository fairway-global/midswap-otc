import React, { useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks';
import { useToast } from '../../hooks/useToast';

export const Login: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user, signIn, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/app" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || submitting) return;
    setSubmitting(true);
    try {
      await signIn(email, password);
      const from = (location.state as { from?: string } | null)?.from ?? '/orderbook';
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        mx: 'auto',
        maxWidth: 1100,
        px: { xs: 2, md: 3 },
        py: { xs: 4, md: 8 },
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', lg: '1.05fr 0.95fr' },
      }}
    >
      <Box
        sx={{
          border: `1px solid ${theme.custom.borderSubtle}`,
          borderRadius: 2,
          p: { xs: 3, md: 4 },
          background: `linear-gradient(160deg, ${alpha(theme.custom.teal, 0.04)} 0%, transparent 60%)`,
        }}
      >
        <Typography
          sx={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.7rem',
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: theme.custom.teal,
          }}
        >
          Platform Access
        </Typography>
        <Typography variant="h3" sx={{ mt: 2, fontFamily: 'Inter, sans-serif', lineHeight: 1.15 }}>
          Regulatory-Compliant Cross-Chain Settlement for Institutions
        </Typography>
        <Typography
          sx={{
            mt: 3,
            color: theme.custom.textSecondary,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.86rem',
            lineHeight: 1.7,
          }}
        >
          Private OTC settlement between verified counterparties across Cardano and Midnight.
          No custodian. No exchange. No counterparty risk.
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 4 }}>
          {[
            { k: 'Direct settlement', v: 'Maker locks → taker locks → both claim atomically.' },
            { k: 'Verified counterparties', v: 'Email-bound institutional accounts.' },
            { k: 'Self-custody', v: 'Funds never leave your wallet.' },
          ].map((it) => (
            <Box
              key={it.k}
              sx={{
                flex: 1,
                p: 2,
                borderRadius: 1.5,
                border: `1px solid ${theme.custom.borderSubtle}`,
              }}
            >
              <Typography
                sx={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.62rem',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: theme.custom.teal,
                }}
              >
                {it.k}
              </Typography>
              <Typography
                sx={{
                  mt: 1,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.74rem',
                  color: theme.custom.textSecondary,
                  lineHeight: 1.5,
                }}
              >
                {it.v}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box
        component="form"
        onSubmit={onSubmit}
        sx={{
          border: `1px solid ${theme.custom.borderSubtle}`,
          borderRadius: 2,
          p: { xs: 3, md: 4 },
        }}
      >
        <Typography
          sx={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.7rem',
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: theme.custom.teal,
          }}
        >
          Sign In
        </Typography>
        <Typography variant="h4" sx={{ mt: 2, fontFamily: 'Inter, sans-serif' }}>
          Access the OTC desk
        </Typography>
        {!configured && (
          <Typography
            sx={{
              mt: 2,
              p: 1.5,
              borderRadius: 1,
              border: `1px solid ${alpha(theme.custom.warning, 0.4)}`,
              bgcolor: alpha(theme.custom.warning, 0.06),
              color: theme.custom.warning,
              fontSize: '0.74rem',
            }}
          >
            Supabase env vars missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in
            <code> htlc-ui/.env.local</code>, then restart the dev server.
          </Typography>
        )}

        <Stack spacing={2} sx={{ mt: 3 }}>
          <Box>
            <Typography
              component="label"
              htmlFor="login-email"
              sx={{
                display: 'block',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.66rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: theme.custom.textMuted,
                mb: 0.75,
              }}
            >
              Work email
            </Typography>
            <TextField
              id="login-email"
              fullWidth
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@institution.com"
            />
          </Box>
          <Box>
            <Typography
              component="label"
              htmlFor="login-password"
              sx={{
                display: 'block',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '0.66rem',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: theme.custom.textMuted,
                mb: 0.75,
              }}
            >
              Password
            </Typography>
            <TextField
              id="login-password"
              fullWidth
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Box>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={!email || !password || submitting || !configured}
            fullWidth
            sx={{ mt: 1 }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
          <Typography
            sx={{
              mt: 1,
              fontSize: '0.74rem',
              color: theme.custom.textMuted,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            No account?{' '}
            <Box
              component={RouterLink}
              to="/signup"
              sx={{
                color: theme.custom.teal,
                textDecoration: 'none',
                fontWeight: 600,
                '&:hover': { color: theme.custom.bridgeCyan },
              }}
            >
              Request access →
            </Box>
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
};
