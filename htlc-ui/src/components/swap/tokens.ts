/**
 * Static token metadata for the swap card. Two tokens only — ADA on Cardano,
 * native USDC on Midnight — and they form a fixed pair; no mainnet-style
 * selector picker is needed.
 */

export interface TokenMeta {
  readonly id: 'ADA' | 'USDC';
  readonly symbol: string;
  readonly name: string;
  readonly chain: 'Cardano' | 'Midnight';
  readonly chainAccent: string;
  readonly decimals: number;
  /** SVG-data-URL-ready monogram — rendered as the "logo" badge. */
  readonly monogramFrom: string;
  readonly monogramTo: string;
}

export const ADA: TokenMeta = {
  id: 'ADA',
  symbol: 'ADA',
  name: 'Cardano ADA',
  chain: 'Cardano',
  chainAccent: '#2E7BFF',
  decimals: 6,
  monogramFrom: '#4B8CFF',
  monogramTo: '#1A4FD1',
};

export const USDC: TokenMeta = {
  id: 'USDC',
  symbol: 'USDC',
  name: 'Midnight USDC',
  chain: 'Midnight',
  chainAccent: '#7C5BFF',
  decimals: 0,
  monogramFrom: '#6B7CFF',
  monogramTo: '#5127D6',
};

export type Direction = 'maker' | 'taker';

/** Pay/receive pair for each direction. */
export const DIRECTION: Record<Direction, { pay: TokenMeta; receive: TokenMeta }> = {
  maker: { pay: ADA, receive: USDC },
  taker: { pay: USDC, receive: ADA },
};
