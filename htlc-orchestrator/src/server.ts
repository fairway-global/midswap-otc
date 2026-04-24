import cors from '@fastify/cors';
import Fastify from 'fastify';
import { resolve } from 'node:path';
import {
  resolveCardanoWatcherConfig,
  startCardanoWatcher,
  type CardanoWatcher,
} from './cardano-watcher.js';
import { openSwapStore } from './db.js';
import { resolveWatcherConfig, startMidnightWatcher, type MidnightWatcher } from './midnight-watcher.js';
import { swapsRoutes } from './routes/swaps.js';
import {
  resolveStuckAlerterConfig,
  startStuckAlerter,
  type StuckAlerter,
} from './stuck-alerter.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DB_PATH = process.env.DB_PATH ?? resolve(process.cwd(), 'swaps.db');

const store = openSwapStore(DB_PATH);

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: { target: 'pino-pretty', options: { colorize: true } },
  },
});

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
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
});

app.get('/health', async () => ({ ok: true, db: DB_PATH }));

await app.register(swapsRoutes(store), { prefix: '/api' });

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
  store.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info({ db: DB_PATH }, 'orchestrator ready');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
