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

/**
 * `Role` is who you are in the swap — `maker` initiates, `taker` responds.
 * `FlowDirection` is which token the maker sends:
 *   - `ada-usdc`: maker locks ADA on Cardano, taker deposits USDC on Midnight
 *   - `usdc-ada`: maker deposits USDC on Midnight, taker locks ADA on Cardano
 *
 * The two flows mirror each other — same protocol, different chain ordering.
 */
export type Role = 'maker' | 'taker';
export type FlowDirection = 'ada-usdc' | 'usdc-ada';

export const FLOW_PAIR: Record<FlowDirection, Record<Role, { pay: TokenMeta; receive: TokenMeta }>> = {
  'ada-usdc': {
    maker: { pay: ADA, receive: USDC },
    taker: { pay: USDC, receive: ADA },
  },
  'usdc-ada': {
    maker: { pay: USDC, receive: ADA },
    taker: { pay: ADA, receive: USDC },
  },
};

/** Legacy alias — old code referred to roles as "direction". */
export type Direction = Role;
export const DIRECTION = FLOW_PAIR['ada-usdc'];
