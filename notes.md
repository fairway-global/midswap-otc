Risks & things to flag

 - Localhost back-end: the deployed site won't function for anyone who
 isn't running the proof server + orchestrator locally. Acknowledged.
 - Blockfrost key in client bundle: unchanged from current behaviour; still
 fine for preprod rate-limited key.
 - Stale ZK assets: if the contracts are ever recompiled, whoever does the
 next Vercel deploy must run cd htlc-ui && npm run copy-zk-assets && git add public/ && git commit
 before vercel deploy. Not a regression, but worth
 remembering since the deploy path no longer does this automatically.
 - tsc in Vercel build: TypeScript errors that slip through locally will
 fail the build. If this bites, we can downgrade buildCommand to
 vite build --mode preprod (skip tsc) for the first deploy.