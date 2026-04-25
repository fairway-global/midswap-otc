import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks';

/**
 * Wrap routes that require a signed-in user. Loading → spinner;
 * unauth → redirect to /login with `from` so we can route back after sign-in.
 *
 * /swap stays public so the legacy share-URL taker flow keeps working.
 */
export const AuthGate: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { user, loading, configured } = useAuth();
  const location = useLocation();

  if (!configured) {
    // Auth disabled — pass through so dev can still see the UI.
    return children;
  }
  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 12 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }
  return children;
};
