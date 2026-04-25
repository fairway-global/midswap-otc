import React from 'react';
import { BrowserRouter, Route, Routes, Navigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from './components';
import { LandingPage } from './components/LandingPage';
import { Home } from './components/Home';
import { Browse } from './components/Browse';
import { Reclaim } from './components/Reclaim';
import { HowTo } from './components/HowTo';
import { Activity } from './components/Activity';
import { Login } from './components/auth/Login';
import { Signup } from './components/auth/Signup';
import { AuthGate } from './components/auth/AuthGate';
import { OrderBook } from './components/orderbook/OrderBook';
import { RfqDetail } from './components/orderbook/RfqDetail';
import { Faucet } from './components/faucet/Faucet';

/**
 * Legacy share URLs looked like `/bob?hash=…&aliceCpk=…&…`. The Home screen
 * now handles both maker and taker modes, so we simply forward those to `/app`
 * while preserving the query string.
 */
const LegacyRedirect: React.FC = () => {
  const [sp] = useSearchParams();
  const suffix = sp.toString();
  return <Navigate to={suffix ? `/app?${suffix}` : '/app'} replace />;
};

const App: React.FC = () => (
  <BrowserRouter>
    <Routes>
      {/* Full-screen hero landing — no MainLayout shell */}
      <Route path="/" element={<LandingPage />} />

      {/* App routes — wrapped in MainLayout with header/footer */}
      <Route
        path="*"
        element={
          <MainLayout>
            <Routes>
              {/* Public — auth pages */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* Public — swap surface (kept unauthenticated for legacy share URLs) */}
              <Route path="/app" element={<Home />} />
              <Route path="/swap" element={<Navigate to="/app" replace />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/reclaim" element={<Reclaim />} />
              <Route path="/how" element={<HowTo />} />
              <Route path="/faucet" element={<Faucet />} />

              {/* Auth-gated — OTC order book + detail */}
              <Route
                path="/orderbook"
                element={
                  <AuthGate>
                    <OrderBook />
                  </AuthGate>
                }
              />
              <Route
                path="/rfq/:id"
                element={
                  <AuthGate>
                    <RfqDetail />
                  </AuthGate>
                }
              />

              {/* Legacy routes kept for existing share URLs and bookmarks */}
              <Route path="/alice" element={<LegacyRedirect />} />
              <Route path="/bob" element={<LegacyRedirect />} />
              <Route path="/mint" element={<Navigate to="/faucet?token=USDC" replace />} />
              <Route path="/mint-usdc" element={<Navigate to="/faucet?token=USDC" replace />} />
              <Route path="/mint-usdm" element={<Navigate to="/faucet?token=USDM" replace />} />
              <Route path="/how-to" element={<Navigate to="/how" replace />} />
              <Route path="/dashboard" element={<Navigate to="/activity" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </MainLayout>
        }
      />
    </Routes>
  </BrowserRouter>
);

export default App;
