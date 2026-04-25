import './globals';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { setNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import App from './App';
import { theme } from './config/theme';
import '@midnight-ntwrk/dapp-connector-api';
import * as pino from 'pino';
import { AuthProvider } from './contexts/AuthContext';
import { SwapProvider } from './contexts/SwapContext';
import { ToastProvider } from './contexts/ToastContext';

const networkId = import.meta.env.VITE_NETWORK_ID as NetworkId;
setNetworkId(networkId);

export const logger = pino.pino({
  level: (import.meta.env.VITE_LOGGING_LEVEL as string) ?? 'info',
});

logger.trace(`networkId = ${networkId}`);

// Build-time stamp — lets you verify at a glance that the browser loaded
// the freshly-built bundle and not a cached one. Injected by vite.config.ts
// via `define` (type declared in vite-env.d.ts). Look for "[Midswap] Bundle
// built at …" in the console on page load; the timestamp should match your
// most recent `npm run build`.
const BUILD_TIME = __BUILD_TIME__;
console.info(
  `%c[KAAMOS] Bundle built at ${BUILD_TIME}`,
  'color: #00637c; font-weight: 600;',
);
(window as unknown as { __MIDSWAP_BUILD_TIME__: string }).__MIDSWAP_BUILD_TIME__ = BUILD_TIME;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ToastProvider>
        <SwapProvider logger={logger}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </SwapProvider>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
