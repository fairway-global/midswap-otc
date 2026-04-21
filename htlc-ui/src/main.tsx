import './globals';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import App from './App';
import { theme } from './config/theme';
import '@midnight-ntwrk/dapp-connector-api';
import * as pino from 'pino';
import { SwapProvider } from './contexts/SwapContext';

const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
setNetworkId(networkId);

export const logger = pino.pino({
  level: (import.meta.env.VITE_LOGGING_LEVEL as string) ?? 'info',
});

logger.trace(`networkId = ${networkId}`);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <CssBaseline />
    <ThemeProvider theme={theme}>
      <SwapProvider logger={logger}>
        <App />
      </SwapProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
