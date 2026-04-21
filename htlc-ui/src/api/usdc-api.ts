/**
 * Browser-side API for the deployed USDC minter contract.
 *
 * Read-only from the UI's perspective — we only need `_color` to match against
 * deposit events. Minting is done off-line via the CLI `mint-usdc.ts` script.
 */

import { type ContractAddress, type ContractState } from '@midnight-ntwrk/compact-runtime';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type Logger } from 'pino';
import { map, type Observable } from 'rxjs';
import * as USDC from '../../../contract/src/managed/usdc/contract/index';
import {
  CompiledUSDCContract,
  usdcPrivateStateKey,
  type DeployedUSDCContract,
  type USDCContract,
  type USDCDerivedState,
  type USDCProviders,
} from './common-types';

export class UsdcAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<USDCDerivedState>;

  private constructor(
    public readonly deployedContract: DeployedUSDCContract,
    providers: USDCProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    this.state$ = providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
      .pipe(
        map((contractState: ContractState) => {
          const ledger = USDC.ledger(contractState.data);
          const emptyColor = ledger._color.every((b) => b === 0);
          return { color: emptyColor ? undefined : new Uint8Array(ledger._color) };
        }),
      );
  }

  static async join(providers: USDCProviders, contractAddress: ContractAddress, logger?: Logger): Promise<UsdcAPI> {
    logger?.info({ joinUSDC: { contractAddress } });
    providers.privateStateProvider.setContractAddress(contractAddress);
    const deployed = await findDeployedContract<USDCContract>(providers, {
      contractAddress,
      compiledContract: CompiledUSDCContract,
      privateStateId: usdcPrivateStateKey,
      initialPrivateState: {},
    });
    return new UsdcAPI(deployed, providers, logger);
  }
}
