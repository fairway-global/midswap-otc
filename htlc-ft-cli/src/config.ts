import path from 'node:path';
import * as fs from 'node:fs';
import {
  type EnvironmentConfiguration,
  RemoteTestEnvironment,
  StaticProofServerContainer,
  type TestEnvironment,
} from '@midnight-ntwrk/testkit-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Logger } from 'pino';

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

export class PreprodRemoteConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('preprod');
    return new PreprodTestEnvironment(logger);
  }
  privateStateStoreName = 'htlc-ft-private-state';
  logDir = path.resolve(currentDir, '..', 'logs', 'preprod-remote', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'htlc-ft');
  requestFaucetTokens = false;
  generateDust = true;
}

export class LocalDevConfig implements Config {
  getEnvironment(logger: Logger): TestEnvironment {
    setNetworkId('undeployed');
    return new LocalDevTestEnvironment(logger);
  }
  privateStateStoreName = 'htlc-ft-private-state-local';
  logDir = path.resolve(currentDir, '..', 'logs', 'local-dev', `${new Date().toISOString()}.log`);
  zkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'htlc-ft');
  requestFaucetTokens = false;
  generateDust = false;
  cardano: CardanoConfig = {
    blockfrostUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
    blockfrostApiKey: process.env.BLOCKFROST_API_KEY ?? '',
    cardanoNetwork: 'Preprod',
    blueprintPath: path.resolve(currentDir, '..', '..', 'cardano', 'plutus.json'),
  };
}

export class LocalDevTestEnvironment extends RemoteTestEnvironment {
  constructor(logger: Logger) {
    super(logger);
    this.start = async () => this.getEnvironmentConfiguration();
  }

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    return {
      walletNetworkId: 'undeployed',
      networkId: 'undeployed',
      indexer: 'http://127.0.0.1:8088/api/v3/graphql',
      indexerWS: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
      node: 'http://127.0.0.1:9944',
      nodeWS: 'ws://127.0.0.1:9944',
      faucet: '', // No faucet in local dev — funds come from midnight-local-dev CLI
      proofServer: 'http://127.0.0.1:6300',
    };
  }
}

export class PreprodTestEnvironment extends RemoteTestEnvironment {
  private static readonly PROOF_SERVER_PORT = 6300;
  private readonly proofServer = new StaticProofServerContainer(PreprodTestEnvironment.PROOF_SERVER_PORT);

  constructor(logger: Logger) {
    super(logger);
    // Skip the testkit health check (1s timeout too tight for remote preprod).
    // Services are validated implicitly when the wallet connects.
    this.start = async () => this.getEnvironmentConfiguration();
  }

  getEnvironmentConfiguration(): EnvironmentConfiguration {
    return {
      walletNetworkId: 'preprod',
      networkId: 'preprod',
      indexer: 'https://indexer.preprod.midnight.network/api/v3/graphql',
      indexerWS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
      node: 'https://rpc.preprod.midnight.network',
      nodeWS: 'wss://rpc.preprod.midnight.network',
      faucet: 'https://faucet.preprod.midnight.network/api/request-tokens',
      proofServer: this.proofServer.getUrl(),
    };
  }
}
