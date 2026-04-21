import { useContext } from 'react';
import { SwapContext, type SwapContextValue } from '../contexts/SwapContext';

export const useSwapContext = (): SwapContextValue => {
  const ctx = useContext(SwapContext);
  if (!ctx) throw new Error('useSwapContext must be used inside a <SwapProvider>');
  return ctx;
};
