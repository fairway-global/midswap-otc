# Design credit

Midswap's interface is inspired by the [Uniswap interface](https://github.com/Uniswap/interface)
— the centered dual-input swap card, the direction-flip button between the two rows, the pill
primary CTA that adapts its label to the current state, the blurred sticky top bar with a
wallet pill on the right, the slide-open settings drawer for deadline controls, and the modal
that drives multi-phase transactions with a vertical stepper.

The palette and branding diverge intentionally: where Uniswap's identity is violet / pink on
near-black, Midswap leans into a Cardano royal blue (`#2E7BFF`) paired with a deep Midnight
background (`#0A0B13`) and a subtle Midnight-violet (`#7C5BFF`) accent for USDC-on-Midnight
surfaces. The typography is `Inter`, matching modern DeFi conventions.

What's ours, not Uniswap's:

- **Protocol** — Midswap is a hash-time-locked atomic swap between Cardano ADA and native
  Midnight USDC, not an AMM. There is no pool, no price curve, no liquidity providers. Each
  swap is a two-party, two-chain escrow.
- **Maker / taker flow** — instead of a single instantaneous swap, Midswap's primary CTA opens
  a progress modal that walks through Cardano-side lock → counterparty deposit → preimage
  reveal → Cardano claim. The stepper UI is our own.
- **Orchestrator-advisory pattern** — the Browse, Activity, and Reclaim pages surface an
  off-chain SQLite index that is purely a view; chain state remains authoritative. Uniswap
  doesn't have this pattern.

Uniswap's interface code is BSD-3 / GPL-3 licensed. Midswap does not copy any Uniswap source;
we only learn from its visual and interaction vocabulary, and adapt the components we need from
scratch using MUI with a custom theme.
