/**
 * Browser-side API for the deployed HTLC escrow contract.
 *
 * Mirrors the structure of `api/src/index.ts` (BBoardAPI):
 *   - private constructor
 *   - `state$` observable combining ledger state
 *   - static `join(providers, address, logger)` factory
 *   - action methods wrapping `deployedContract.callTx.*`
 */

import { type ContractAddress, type ContractState } from '@midnight-ntwrk/compact-runtime';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { type Logger } from 'pino';
import { map, type Observable } from 'rxjs';
import * as HTLC from '../../../contract/src/managed/htlc/contract/index';
import type {
  Either,
  ContractAddress as HtlcContractAddress,
  UserAddress as HtlcUserAddress,
} from '../../../contract/src/managed/htlc/contract/index';
import {
  CompiledHTLCContract,
  htlcPrivateStateKey,
  type DeployedHTLCContract,
  type HTLCContract,
  type HTLCDerivedState,
  type HTLCEntry,
  type HTLCProviders,
} from './common-types';

export interface DeployedHTLCAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<HTLCDerivedState>;

  deposit(params: DepositParams): Promise<string>;
  withdrawWithPreimage(preimage: Uint8Array): Promise<string>;
  reclaimAfterExpiry(hash: Uint8Array): Promise<string>;
}

export interface DepositParams {
  color: Uint8Array;
  amount: bigint;
  hash: Uint8Array;
  /** Contract time is seconds (Uint<64>); callers convert from ms before passing. */
  expirySecs: bigint;
  receiverAuth: Uint8Array;
  receiverPayout: Either<HtlcContractAddress, HtlcUserAddress>;
  senderPayout: Either<HtlcContractAddress, HtlcUserAddress>;
}

const readLedgerMap = <V>(
  map_: { member(k: Uint8Array): boolean; lookup(k: Uint8Array): V },
  key: Uint8Array,
): V | undefined => (map_.member(key) ? map_.lookup(key) : undefined);

const ledgerToDerivedState = (ledger: HTLC.Ledger): HTLCDerivedState => {
  const entries = new Map<string, HTLCEntry>();
  for (const [hashBytes, amount] of ledger.htlcAmounts) {
    const hashHex = toHex(hashBytes);
    entries.set(hashHex, {
      hashHex,
      amount,
      expirySecs: readLedgerMap(ledger.htlcExpiries, hashBytes) ?? 0n,
      color: readLedgerMap(ledger.htlcColors, hashBytes) ?? new Uint8Array(32),
      senderAuth: readLedgerMap(ledger.htlcSenderAuth, hashBytes) ?? new Uint8Array(32),
      receiverAuth: readLedgerMap(ledger.htlcReceiverAuth, hashBytes) ?? new Uint8Array(32),
      senderPayout:
        readLedgerMap(ledger.htlcSenderPayout, hashBytes) ??
        ({ is_left: false, left: { bytes: new Uint8Array(32) }, right: { bytes: new Uint8Array(32) } } as Either<
          HtlcContractAddress,
          HtlcUserAddress
        >),
      receiverPayout:
        readLedgerMap(ledger.htlcReceiverPayout, hashBytes) ??
        ({ is_left: false, left: { bytes: new Uint8Array(32) }, right: { bytes: new Uint8Array(32) } } as Either<
          HtlcContractAddress,
          HtlcUserAddress
        >),
      revealedPreimage: readLedgerMap(ledger.revealedPreimages, hashBytes),
    });
  }
  return { entries };
};

export class HtlcAPI implements DeployedHTLCAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<HTLCDerivedState>;

  private constructor(
    public readonly deployedContract: DeployedHTLCContract,
    _providers: HTLCProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    this.state$ = _providers.publicDataProvider
      .contractStateObservable(this.deployedContractAddress, { type: 'latest' })
      .pipe(map((contractState: ContractState) => ledgerToDerivedState(HTLC.ledger(contractState.data))));
  }

  async deposit(p: DepositParams): Promise<string> {
    this.logger?.info({ amount: p.amount, hashHex: toHex(p.hash) }, 'htlc.deposit');
    const txData = await this.deployedContract.callTx.deposit(
      p.color,
      p.amount,
      p.hash,
      p.expirySecs,
      p.receiverAuth,
      p.receiverPayout,
      p.senderPayout,
    );
    this.logger?.trace({
      transactionAdded: {
        circuit: 'deposit',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
    return txData.public.txHash;
  }

  async withdrawWithPreimage(preimage: Uint8Array): Promise<string> {
    this.logger?.info({ preimageLen: preimage.length }, 'htlc.withdrawWithPreimage');
    const txData = await this.deployedContract.callTx.withdrawWithPreimage(preimage);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'withdrawWithPreimage',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
    return txData.public.txHash;
  }

  async reclaimAfterExpiry(hash: Uint8Array): Promise<string> {
    this.logger?.info({ hashHex: toHex(hash) }, 'htlc.reclaimAfterExpiry');
    const txData = await this.deployedContract.callTx.reclaimAfterExpiry(hash);
    this.logger?.trace({
      transactionAdded: {
        circuit: 'reclaimAfterExpiry',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
    return txData.public.txHash;
  }

  static async join(providers: HTLCProviders, contractAddress: ContractAddress, logger?: Logger): Promise<HtlcAPI> {
    logger?.info({ joinHTLC: { contractAddress } });
    providers.privateStateProvider.setContractAddress(contractAddress);
    const deployed = await findDeployedContract<HTLCContract>(providers, {
      contractAddress,
      compiledContract: CompiledHTLCContract,
      privateStateId: htlcPrivateStateKey,
      initialPrivateState: {},
    });
    logger?.trace({ contractJoined: { finalizedDeployTxData: deployed.deployTxData.public } });
    return new HtlcAPI(deployed, providers, logger);
  }
}
