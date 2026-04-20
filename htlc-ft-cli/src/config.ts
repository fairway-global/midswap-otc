import path from 'node:path';
import * as fs from 'node:fs';
import {
  type EnvironmentConfiguration,
  RemoteTestEnvironment,
  type TestEnvironment,
} from '@midnight-ntwrk/testkit-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Logger } from 'pino';

export type MidnightNetwork = 'undeployed' | 'preprod';

const LOCAL_PROOF_SERVER_URL = 'http://127.0.0.1:6300';

const LOCAL_DEV_ENV: EnvironmentConfiguration = {
  walletNetworkId: 'undeployed',
  networkId: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v3/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
  node: 'http://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  faucet: '',
  proofServer: LOCAL_PROOF_SERVER_URL,
};

const PREPROD_ENV: EnvironmentConfiguration = {
  walletNetworkId: 'preprod',
  networkId: 'preprod',
  indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  nodeWS: 'wss://rpc.preprod.midnight.network',
  faucet: 'https://faucet.preprod.midnight.network/api/request-tokens',
  proofServer: LOCAL_PROOF_SERVER_URL,
};

export function getMidnightNetwork(): MidnightNetwork {
  const raw = (process.env.MIDNIGHT_NETWORK ?? 'undeployed').toLowerCase();
  if (raw === 'preprod') return 'preprod';
  if (raw === 'undeployed' || raw === 'local' || raw === 'localdev') return 'undeployed';
  throw new Error(`Unsupported MIDNIGHT_NETWORK: ${process.env.MIDNIGHT_NETWORK}`);
}

export function getMidnightEnv(): EnvironmentConfiguration {
  return getMidnightNetwork() === 'preprod' ? PREPROD_ENV : LOCAL_DEV_ENV;
}

export function applyMidnightNetwork(): MidnightNetwork {
  const net = getMidnightNetwork();
  setNetworkId(net);
  return net;
}

// Load .env file from htlc-ft-cli root (no dotenv dependency)
const envPath = path.resolve(new URL(import.meta.url).pathname, '..', '..', '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export interface CardanoConfig {
  readonly blockfrostUrl: string;
  readonly blockfrostApiKey: string;
  readonly cardanoNetwork: 'Preview' | 'Preprod' | 'Mainnet';
  readonly blueprintPath: string;
}

export interface Config {
  readonly privateStateStoreName: string;
  readonly logDir: string;
  readonly zkConfigPath: string;
  getEnvironment(logger: Logger): TestEnvironment;
  readonly requestFaucetTokens: boolean;
  readonly generateDust: boolean;
  readonly cardano?: CardanoConfig;
}

export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

const cardanoConfig: CardanoConfig = {
  blockfrostUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
  blockfrostApiKey: process.env.BLOCKFROST_API_KEY ?? '',
  cardanoNetwork: 'Preprod',
  blueprintPath: path.resolve(currentDir, '..', '..', 'cardano', 'plutus.json'),
};

export class PreprodRemoteConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('preprod');
    return new PreprodTestEnvironment(logger);
  }
  privateStateStoreName = 'htlc-private-state-preprod';
  logDir = path.resolve(currentDir, '..', 'logs', 'preprod-remote', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'htlc');
  requestFaucetTokens = false;
  generateDust = true;
  cardano: CardanoConfig = cardanoConfig;
}

export class LocalDevConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('undeployed');
    return new LocalDevTestEnvironment(logger);
  }
  privateStateStoreName = 'htlc-private-state-local';
  logDir = path.resolve(currentDir, '..', 'logs', 'local-dev', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'htlc');
  requestFaucetTokens = false;
  generateDust = false;
  cardano: CardanoConfig = cardanoConfig;
}

export class LocalDevTestEnvironment extends RemoteTestEnvironment {
  constructor(logger: Logger) {
    super(logger);
    this.start = async () => this.getEnvironmentConfiguration();
  }

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    return LOCAL_DEV_ENV;
  }
}

export class PreprodTestEnvironment extends RemoteTestEnvironment {
  constructor(logger: Logger) {
    super(logger);
    // Skip the testkit health check (1s timeout too tight for remote preprod).
    // Services are validated implicitly when the wallet connects.
    this.start = async () => this.getEnvironmentConfiguration();
  }

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    return PREPROD_ENV;
  }
}
