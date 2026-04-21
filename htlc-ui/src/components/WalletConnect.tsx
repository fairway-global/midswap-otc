import React, { useState } from 'react';
import { Alert, Button, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import { useSwapContext } from '../hooks';

export const WalletConnect: React.FC = () => {
  const { session, connecting, error, connect, cardano, cardanoConnecting, cardanoError, connectCardano } =
    useSwapContext();
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [cardanoLocalError, setCardanoLocalError] = useState<string | undefined>(undefined);

  const onConnectLace = async () => {
    setLocalError(undefined);
    try {
      await connect();
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  const onConnectEternl = async () => {
    setCardanoLocalError(undefined);
    try {
      await connectCardano();
    } catch (e) {
      setCardanoLocalError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card sx={{ width: '100%', maxWidth: 720 }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Wallets</Typography>

          <Stack spacing={1}>
            <Typography variant="subtitle1">Midnight — Lace</Typography>
            {session ? (
              <Stack spacing={0.5}>
                <Chip label="Connected" color="success" sx={{ alignSelf: 'flex-start' }} />
                <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                  coin pubkey (hex): {session.bootstrap.coinPublicKeyHex}
                </Typography>
                <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                  unshielded (hex): {session.bootstrap.unshieldedAddressHex}
                </Typography>
              </Stack>
            ) : (
              <Button variant="contained" onClick={onConnectLace} disabled={connecting}>
                {connecting ? 'Connecting…' : 'Connect Lace'}
              </Button>
            )}
            {(error || localError) && <Alert severity="error">{localError ?? error?.message}</Alert>}
          </Stack>

          <Divider />

          <Stack spacing={1}>
            <Typography variant="subtitle1">Cardano — Eternl (CIP-30)</Typography>
            {cardano ? (
              <Stack spacing={0.5}>
                <Chip label="Connected" color="success" sx={{ alignSelf: 'flex-start' }} />
                <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                  PKH: {cardano.paymentKeyHash}
                </Typography>
                <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                  address: {cardano.address}
                </Typography>
              </Stack>
            ) : (
              <Button variant="contained" color="secondary" onClick={onConnectEternl} disabled={cardanoConnecting}>
                {cardanoConnecting ? 'Connecting…' : 'Connect Cardano wallet'}
              </Button>
            )}
            {(cardanoError || cardanoLocalError) && (
              <Alert severity="error">{cardanoLocalError ?? cardanoError?.message}</Alert>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};
