import React, { useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link as RouterLink, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks';
import { useToast } from '../../hooks/useToast';

export const Signup: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, signUp, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [institutionName, setInstitutionName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/app" replace />;

  const valid = email.includes('@') && password.length >= 8 && fullName && institutionName;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await signUp(email, password, fullName, institutionName);
      toast.success('Account created');
      navigate('/orderbook', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign-up failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ mx: 'auto', maxWidth: 520, px: 2, py: { xs: 4, md: 8 } }}>
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
          Request Access
        </Typography>
        <Typography variant="h4" sx={{ mt: 2, fontFamily: 'Inter, sans-serif' }}>
          Create your institutional account
        </Typography>
        <Typography
          sx={{
            mt: 2,
            color: theme.custom.textSecondary,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.74rem',
            lineHeight: 1.6,
          }}
        >
          Roles are per-order — anyone in the network can post, quote, accept, or settle. Your
          institutional name is shown on the order book to counterparties.
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
            Supabase env vars missing — see <code>htlc-ui/.env.local</code>.
          </Typography>
        )}

        <Stack spacing={2} sx={{ mt: 3 }}>
          <Field label="Full name" id="signup-name">
            <TextField
              id="signup-name"
              fullWidth
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Mei Tanaka"
              autoComplete="name"
            />
          </Field>
          <Field label="Institution" id="signup-inst">
            <TextField
              id="signup-inst"
              fullWidth
              value={institutionName}
              onChange={(e) => setInstitutionName(e.target.value)}
              placeholder="Acme Capital"
              autoComplete="organization"
            />
          </Field>
          <Field label="Work email" id="signup-email">
            <TextField
              id="signup-email"
              fullWidth
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@institution.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Password (min 8 chars)" id="signup-pw">
            <TextField
              id="signup-pw"
              fullWidth
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>

          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={!valid || submitting || !configured}
            fullWidth
            sx={{ mt: 1 }}
          >
            {submitting ? 'Creating…' : 'Create account'}
          </Button>
          <Typography
            sx={{
              mt: 1,
              fontSize: '0.74rem',
              color: theme.custom.textMuted,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            Already have an account?{' '}
            <Box
              component={RouterLink}
              to="/login"
              sx={{
                color: theme.custom.teal,
                textDecoration: 'none',
                fontWeight: 600,
                '&:hover': { color: theme.custom.bridgeCyan },
              }}
            >
              Sign in →
            </Box>
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
};

const Field: React.FC<{ label: string; id: string; children: React.ReactNode }> = ({
  label,
  id,
  children,
}) => {
  const theme = useTheme();
  return (
    <Box>
      <Typography
        component="label"
        htmlFor={id}
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
        {label}
      </Typography>
      {children}
    </Box>
  );
};
