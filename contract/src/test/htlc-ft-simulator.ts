// HTLC-FT contract test simulator
// Wraps the compiled HTLC-FT contract (FungibleToken + concurrent HTLC escrow) for testing.
// Supports multiple simultaneous swaps, each keyed by its hash lock.

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  emptyZswapLocalState,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  type Either,
  type ZswapCoinPublicKey,
  type ContractAddress,
  ledger,
} from "../managed/htlc-ft/contract/index.js";
import {
  NetworkId,
  setNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";

setNetworkId("undeployed" as NetworkId);

type EmptyPrivateState = Record<string, never>;

export class HTLCFTSimulator {
  readonly contract: Contract<EmptyPrivateState>;
  circuitContext: CircuitContext<EmptyPrivateState>;

  constructor(
    coinPublicKey: string,
    tokenName: string,
    tokenSymbol: string,
    tokenDecimals: bigint,
    blockTimeSeconds?: number,
  ) {
    this.contract = new Contract<EmptyPrivateState>({});

    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      createConstructorContext({} as EmptyPrivateState, coinPublicKey),
      tokenName,
      tokenSymbol,
      tokenDecimals,
    );

    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };

    if (blockTimeSeconds !== undefined) {
      this.setBlockTime(blockTimeSeconds);
    }
  }

  setBlockTime(unixSeconds: number): void {
    const qc = this.circuitContext.currentQueryContext as any;
    qc.block = { ...qc.block, secondsSinceEpoch: BigInt(unixSeconds) };
  }

  switchUser(coinPublicKey: string): void {
    const prevIndex =
      this.circuitContext.currentZswapLocalState.currentIndex;
    this.circuitContext.currentZswapLocalState = {
      ...emptyZswapLocalState(coinPublicKey),
      currentIndex: prevIndex,
    };
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  myAddr(): Uint8Array {
    const { context, result } = this.contract.impureCircuits.myAddr(
      this.circuitContext,
    );
    this.circuitContext = context;
    return result;
  }

  /** Build an Either<ZswapCoinPublicKey, ContractAddress> for the current user. */
  callerAddress(): Either<ZswapCoinPublicKey, ContractAddress> {
    const bytes = this.myAddr();
    return {
      is_left: true,
      left: { bytes },
      right: { bytes: new Uint8Array(32) },
    };
  }

  // ===== FungibleToken operations =====

  totalSupply(): bigint {
    const { context, result } = this.contract.impureCircuits.totalSupply(
      this.circuitContext,
    );
    this.circuitContext = context;
    return result;
  }

  balanceOf(account: Either<ZswapCoinPublicKey, ContractAddress>): bigint {
    const { context, result } = this.contract.impureCircuits.balanceOf(
      this.circuitContext,
      account,
    );
    this.circuitContext = context;
    return result;
  }

  mint(account: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint): void {
    const { context } = this.contract.impureCircuits.mint(
      this.circuitContext,
      account,
      value,
    );
    this.circuitContext = context;
  }

  transfer(to: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint): boolean {
    const { context, result } = this.contract.impureCircuits.transfer(
      this.circuitContext,
      to,
      value,
    );
    this.circuitContext = context;
    return result;
  }

  // ===== HTLC operations =====

  deposit(
    amount: bigint,
    hash: Uint8Array,
    expiryTime: bigint,
    receiver: Uint8Array,
  ): void {
    const { context } =
      this.contract.impureCircuits.depositWithHashTimeLock(
        this.circuitContext,
        amount,
        hash,
        expiryTime,
        receiver,
      );
    this.circuitContext = context;
  }

  withdraw(preimage: Uint8Array): void {
    const { context } =
      this.contract.impureCircuits.withdrawWithPreimage(
        this.circuitContext,
        preimage,
      );
    this.circuitContext = context;
  }

  reclaim(hash: Uint8Array): void {
    const { context } = this.contract.impureCircuits.reclaimAfterExpiry(
      this.circuitContext,
      hash,
    );
    this.circuitContext = context;
  }

  // ===== Swap query helpers =====

  isSwapActive(hash: Uint8Array): boolean {
    const state = this.getLedger();
    return state.htlcAmounts.member(hash) && state.htlcAmounts.lookup(hash) > 0n;
  }

  getSwapAmount(hash: Uint8Array): bigint {
    const state = this.getLedger();
    if (!state.htlcAmounts.member(hash)) return 0n;
    return state.htlcAmounts.lookup(hash);
  }

  getSwapExpiry(hash: Uint8Array): bigint {
    const state = this.getLedger();
    if (!state.htlcExpiries.member(hash)) return 0n;
    return state.htlcExpiries.lookup(hash);
  }

  getSwapReceiver(hash: Uint8Array): Uint8Array | null {
    const state = this.getLedger();
    if (!state.htlcReceivers.member(hash)) return null;
    return state.htlcReceivers.lookup(hash);
  }
}
