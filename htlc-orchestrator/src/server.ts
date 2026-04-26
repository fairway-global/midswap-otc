import cors from '@fastify/cors';
import Fastify from 'fastify';
import { resolve } from 'node:path';
import { supabaseAuthPlugin } from './auth/middleware.js';
import {
  resolveCardanoWatcherConfig,
  startCardanoWatcher,
  type CardanoWatcher,
} from './cardano-watcher.js';
import { openDatabase, openOtcStore, openSwapStore } from './db.js';
import { resolveWatcherConfig, startMidnightWatcher, type MidnightWatcher } from './midnight-watcher.js';
import { activityRoutes } from './routes/activity.js';
import { authRoutes } from './routes/auth.js';
import { quotesRoutes } from './routes/quotes.js';
import { rfqsRoutes } from './routes/rfqs.js';
import { swapsRoutes } from './routes/swaps.js';
import { createNotifier } from './services/notifications.js';
import {
  resolveStuckAlerterConfig,
  startStuckAlerter,
  type StuckAlerter,
} from './stuck-alerter.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DB_PATH = process.env.DB_PATH ?? resolve(process.cwd(), 'swaps.db');

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: { target: 'pino-pretty', options: { colorize: true } },
  },
});

// One Database connection shared by both stores so the OTC bridge updates
// (linkSwapToRfq / markRfqSettled) and the swap watchers see the same WAL.
// The notifier writes to Supabase Postgres (NOT this DB) for Realtime fanout;
// it's fire-and-forget so disabled-Supabase environments still work.
const db = openDatabase(DB_PATH);
const notifier = createNotifier(app.log);
const otcStore = openOtcStore(db, notifier);
const store = openSwapStore(db, otcStore);

const DEFAULT_ORIGINS = [
  'http://localhost:5199',
  'http://localhost:5173',
  'http://localhost:8080',
  'https://midnight.finance',
  'https://www.midnight.finance',
  'https://midswap.vercel.app',
];
const extraOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: [...DEFAULT_ORIGINS, ...extraOrigins],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

await app.register(supabaseAuthPlugin, { store: otcStore });

app.get('/health', async () => ({ ok: true, db: DB_PATH }));

await app.register(swapsRoutes(store), { prefix: '/api' });
await app.register(authRoutes(otcStore), { prefix: '/api' });
await app.register(rfqsRoutes(otcStore), { prefix: '/api' });
await app.register(quotesRoutes(otcStore), { prefix: '/api' });
await app.register(activityRoutes(otcStore), { prefix: '/api' });

let midnightWatcher: MidnightWatcher | null = null;
const midnightWatcherConfig = resolveWatcherConfig(app.log);
if (midnightWatcherConfig) {
  midnightWatcher = startMidnightWatcher(store, midnightWatcherConfig, app.log);
}

let cardanoWatcher: CardanoWatcher | null = null;
const cardanoWatcherConfig = resolveCardanoWatcherConfig(app.log);
if (cardanoWatcherConfig) {
  cardanoWatcher = startCardanoWatcher(store, cardanoWatcherConfig, app.log);
}

let stuckAlerter: StuckAlerter | null = null;
const stuckAlerterConfig = resolveStuckAlerterConfig(app.log);
if (stuckAlerterConfig) {
  stuckAlerter = startStuckAlerter(store, stuckAlerterConfig, app.log);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  midnightWatcher?.stop();
  cardanoWatcher?.stop();
  stuckAlerter?.stop();
  await app.close();
  // store.close() closes the shared db handle — both stores release together.
  store.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info({ db: DB_PATH }, 'orchestrator ready');
  // Fire-and-forget — startup probe for the Supabase notifications table.
  // Logs a loud banner if the SQL migration hasn't been applied. Doesn't
  // block startup either way.
  void notifier.probe();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
