/**
 * Common types for the HTLC atomic-swap UI.
 *
 * Re-exports the Provider / CircuitKeys types from the contract package,
 * and adds the derived-state shapes the React components subscribe to.
 */

export {
  htlcPrivateStateKey,
  CompiledHTLCContract,
  type HTLCContract,
  type HTLCCircuitKeys,
  type HTLCPrivateStateId,
  type HTLCProviders,
  type DeployedHTLCContract,
  type EmptyPrivateState,
} from '../../../contract/src/htlc-contract';

export {
  usdcPrivateStateKey,
  CompiledUSDCContract,
  type USDCContract,
  type USDCCircuitKeys,
  type USDCPrivateStateId,
  type USDCProviders,
  type DeployedUSDCContract,
} from '../../../contract/src/usdc-contract';

import type { Either, ContractAddress, UserAddress } from '../../../contract/src/managed/htlc/contract/index';

/**
 * One row in the HTLC ledger, keyed by `hash`.
 * Mirrors the per-hash maps in `htlc.compact`.
 */
export interface HTLCEntry {
  readonly hashHex: string;
  readonly amount: bigint;
  readonly expirySecs: bigint;
  readonly color: Uint8Array;
  readonly senderAuth: Uint8Array;
  readonly receiverAuth: Uint8Array;
  readonly senderPayout: Either<ContractAddress, UserAddress>;
  readonly receiverPayout: Either<ContractAddress, UserAddress>;
  readonly revealedPreimage?: Uint8Array;
}

export interface HTLCDerivedState {
  readonly entries: ReadonlyMap<string, HTLCEntry>;
}

export interface USDCDerivedState {
  readonly color: Uint8Array | undefined;
}
