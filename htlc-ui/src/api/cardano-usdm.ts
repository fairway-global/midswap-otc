/**
 * USDM minting-policy helpers for the browser.
 *
 * Mirrors `usdc-api.ts`'s role for the Midnight side: loads the always-true
 * PlutusV3 mint policy from the Aiken blueprint, derives the canonical USDM
 * policyId + unit, and offers mint / balance helpers that share the Lucid
 * instance held by `CardanoHTLCBrowser`.
 */

import {
  Data,
  mintingPolicyToId,
  type LucidEvolution,
  type MintingPolicy,
} from '@lucid-evolution/lucid';
import type { Logger } from 'pino';

/** ASCII "USDM" as hex — the on-chain asset name under the USDM policy. */
export const USDM_ASSET_NAME_HEX = '5553444d';

export interface UsdmPolicy {
  readonly policy: MintingPolicy;
  readonly policyId: string;
  readonly assetNameHex: string;
  /** `policyId + assetNameHex` — the "unit" key used in UTxO assets maps. */
  readonly unit: string;
}

/**
 * Load the USDM minting policy from the Aiken blueprint. The policy validator
 * is `usdm.usdm.mint` — always-true, so any connected wallet can mint.
 */
export const loadUsdmPolicy = async (blueprintUrl = '/plutus.json'): Promise<UsdmPolicy> => {
  const res = await fetch(blueprintUrl);
  if (!res.ok) throw new Error(`Failed to fetch blueprint from ${blueprintUrl}: ${res.status}`);
  const blueprint = (await res.json()) as { validators: Array<{ title: string; compiledCode: string }> };
  const v = blueprint.validators.find((x) => x.title === 'usdm.usdm.mint');
  if (!v) throw new Error('usdm.usdm.mint validator not found in blueprint');
  const policy: MintingPolicy = { type: 'PlutusV3', script: v.compiledCode };
  const policyId = mintingPolicyToId(policy);
  return { policy, policyId, assetNameHex: USDM_ASSET_NAME_HEX, unit: policyId + USDM_ASSET_NAME_HEX };
};

/**
 * Mint `qty` USDM and send to `recipientBech32`. Uses `Data.void()` as the
 * redeemer — the policy ignores it but Lucid still needs something to encode.
 */
export const mintUsdm = async (
  lucid: LucidEvolution,
  policy: UsdmPolicy,
  recipientBech32: string,
  qty: bigint,
  logger?: Logger,
): Promise<string> => {
  if (qty <= 0n) throw new Error('Mint amount must be positive.');
  logger?.info({ qty, recipient: recipientBech32.slice(0, 20) }, 'USDM: mint');
  const tx = await lucid
    .newTx()
    .mintAssets({ [policy.unit]: qty }, Data.void())
    .attach.MintingPolicy(policy.policy)
    .pay.ToAddress(recipientBech32, { [policy.unit]: qty })
    .complete();
  const signed = await tx.sign.withWallet().complete();
  const txHash = await signed.submit();
  logger?.info({ txHash }, 'USDM: mint tx submitted');
  return txHash;
};

/** Sum USDM balance across the connected wallet's UTxOs. */
export const getUsdmBalance = async (lucid: LucidEvolution, unit: string): Promise<bigint> => {
  const utxos = await lucid.wallet().getUtxos();
  let total = 0n;
  for (const u of utxos) total += u.assets[unit] ?? 0n;
  return total;
};
