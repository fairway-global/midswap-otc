/**
 * Static token metadata for the swap card. Two tokens only — USDM on Cardano
 * (native asset minted by the permissionless `usdm.ak` policy) and native USDC
 * on Midnight. Both are integer-unit stablecoins; they form a fixed pair, so
 * no mainnet-style token picker is needed.
 */

export interface TokenMeta {
  readonly id: 'USDM' | 'USDC';
  readonly symbol: string;
  readonly name: string;
  readonly chain: 'Cardano' | 'Midnight';
  readonly chainAccent: string;
  readonly decimals: number;
  /** SVG-data-URL-ready monogram — rendered as the "logo" badge. */
  readonly monogramFrom: string;
  readonly monogramTo: string;
}

export const USDM: TokenMeta = {
  id: 'USDM',
  symbol: 'USDM',
  name: 'Cardano USDM',
  chain: 'Cardano',
  chainAccent: '#2E7BFF',
  decimals: 0,
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
 *   - `usdm-usdc`: maker locks USDM on Cardano, taker deposits USDC on Midnight
 *   - `usdc-usdm`: maker deposits USDC on Midnight, taker locks USDM on Cardano
 *
 * The two flows mirror each other — same protocol, different chain ordering.
 */
export type Role = 'maker' | 'taker';
export type FlowDirection = 'usdm-usdc' | 'usdc-usdm';

export const FLOW_PAIR: Record<FlowDirection, Record<Role, { pay: TokenMeta; receive: TokenMeta }>> = {
  'usdm-usdc': {
    maker: { pay: USDM, receive: USDC },
    taker: { pay: USDC, receive: USDM },
  },
  'usdc-usdm': {
    maker: { pay: USDC, receive: USDM },
    taker: { pay: USDM, receive: USDC },
  },
};

/** Legacy alias — old code referred to roles as "direction". */
export type Direction = Role;
export const DIRECTION = FLOW_PAIR['usdm-usdc'];
