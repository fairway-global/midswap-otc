import React from 'react';
import { BrowserRouter, Route, Routes, Navigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from './components';
import { Home } from './components/Home';
import { Browse } from './components/Browse';
import { Reclaim } from './components/Reclaim';
import { MintUsdc } from './components/MintUsdc';
import { HowTo } from './components/HowTo';
import { Activity } from './components/Activity';

/**
 * Legacy share URLs looked like `/bob?hash=…&aliceCpk=…&…`. The Home screen
 * now handles both maker and taker modes, so we simply forward those to `/`
 * while preserving the query string.
 */
const LegacyRedirect: React.FC = () => {
  const [sp] = useSearchParams();
  const suffix = sp.toString();
  return <Navigate to={suffix ? `/?${suffix}` : '/'} replace />;
};

const App: React.FC = () => (
  <BrowserRouter>
    <MainLayout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/swap" element={<Home />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/reclaim" element={<Reclaim />} />
        <Route path="/mint" element={<MintUsdc />} />
        <Route path="/how" element={<HowTo />} />
        {/* Legacy routes kept for existing share URLs and bookmarks */}
        <Route path="/alice" element={<LegacyRedirect />} />
        <Route path="/bob" element={<LegacyRedirect />} />
        <Route path="/mint-usdc" element={<Navigate to="/mint" replace />} />
        <Route path="/how-to" element={<Navigate to="/how" replace />} />
        <Route path="/dashboard" element={<Navigate to="/activity" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MainLayout>
  </BrowserRouter>
);

export default App;
