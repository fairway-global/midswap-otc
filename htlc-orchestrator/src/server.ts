import cors from '@fastify/cors';
import Fastify from 'fastify';
import { resolve } from 'node:path';
import { openSwapStore } from './db.js';
import { resolveWatcherConfig, startMidnightWatcher, type MidnightWatcher } from './midnight-watcher.js';
import { swapsRoutes } from './routes/swaps.js';

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

await app.register(cors, {
  origin: [
    'http://localhost:5199',
    'http://localhost:5173',
    'http://localhost:8080',
  ],
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
});

app.get('/health', async () => ({ ok: true, db: DB_PATH }));

await app.register(swapsRoutes(store), { prefix: '/api' });

let watcher: MidnightWatcher | null = null;
const watcherConfig = resolveWatcherConfig(app.log);
if (watcherConfig) {
  watcher = startMidnightWatcher(store, watcherConfig, app.log);
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  watcher?.stop();
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
