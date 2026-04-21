import React from 'react';
import { Box } from '@mui/material';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { MainLayout } from './components';
import { Landing } from './components/Landing';
import { AliceSwap } from './components/AliceSwap';
import { BobSwap } from './components/BobSwap';
import { Reclaim } from './components/Reclaim';

const App: React.FC = () => (
  <Box sx={{ background: '#000', minHeight: '100vh' }}>
    <BrowserRouter>
      <MainLayout>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/alice" element={<AliceSwap />} />
          <Route path="/bob" element={<BobSwap />} />
          <Route path="/reclaim" element={<Reclaim />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MainLayout>
    </BrowserRouter>
  </Box>
);

export default App;
