/**
 * "Key bundle" — a compact single-string representation of a Midnight
 * counterparty's two keys (shielded coin key + unshielded address), joined
 * by `:`. Bech32m charset doesn't include `:` and neither does hex, so the
 * separator is unambiguous for both encodings.
 *
 * Used by WalletMenu's "Copy both keys" button and SwapCard's "Paste bundle"
 * affordance in the reverse-maker flow — one copy-paste instead of two.
 */

export const KEY_BUNDLE_SEPARATOR = ':';

export const formatKeyBundle = (cpk: string, unshielded: string): string =>
  `${cpk.trim()}${KEY_BUNDLE_SEPARATOR}${unshielded.trim()}`;

export interface ParsedKeyBundle {
  cpk: string;
  unshielded: string;
}

export const parseKeyBundle = (input: string): ParsedKeyBundle | undefined => {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(KEY_BUNDLE_SEPARATOR);
  if (parts.length !== 2) return undefined;
  const cpk = parts[0].trim();
  const unshielded = parts[1].trim();
  if (!cpk || !unshielded) return undefined;
  return { cpk, unshielded };
};
