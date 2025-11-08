const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const logger = require('../utils/logger');

const projectRoot = path.resolve(__dirname, '..', '..');
const env = process.env.NODE_ENV || 'development';
const envFile = env === 'production' ? '.env.production' : '.env';

function loadEnvironmentFile() {
  const candidates = Array.from(
    new Set([
      path.join(projectRoot, envFile),
      path.join(process.cwd(), envFile),
    ]),
  );

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        dotenv.config({ path: candidate });
        return candidate;
      }
    } catch (error) {
      logger.warn('Failed to load environment file', { envFile, candidate, error: error.message });
    }
  }

  return null;
}

loadEnvironmentFile();

function parseInteger(value, defaultValue = null) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseList(value, defaultValue = []) {
  if (!value) {
    return defaultValue;
  }

  if (Array.isArray(value)) {
    return value;
  }

  return Array.from(
    new Set(
      String(value)
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function resolveNetworkAliases(network) {
  const normalized = String(network || '').trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const aliasGroups = [
    ['localhost', 'local', 'hardhat'],
  ];

  const aliases = new Set([normalized]);

  for (const group of aliasGroups) {
    if (group.includes(normalized)) {
      group.forEach((alias) => aliases.add(alias));
    }
  }

  return Array.from(aliases);
}

function loadDeploymentArtifact(contractName, network) {
  const searchRoots = [projectRoot, process.cwd()];
  const networkAliases = resolveNetworkAliases(network);

  for (const rootDir of searchRoots) {
    const deploymentDir = path.join(rootDir, 'deployments');
    if (!fs.existsSync(deploymentDir)) {
      continue;
    }

    const candidates = [];

    if (networkAliases.length > 0) {
      networkAliases.forEach((alias) => {
        candidates.push(path.join(deploymentDir, `${contractName}-${alias}.json`));
      });
    }

    candidates.push(path.join(deploymentDir, `${contractName}.json`));

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      try {
        const contents = fs.readFileSync(candidate, 'utf8');
        return JSON.parse(contents);
      } catch (error) {
        logger.warn('Unable to parse deployment artifact', { candidate, error: error.message });
      }
    }
  }

  return null;
}

const network = process.env.CHAIN_NETWORK || process.env.NETWORK || 'localhost';
const dexDeployment = loadDeploymentArtifact('dex', network);

function extractDexAddress(deployment) {
  if (!deployment) {
    return '';
  }

  if (typeof deployment === 'string') {
    return deployment;
  }

  if (deployment.address) {
    return deployment.address;
  }

  if (deployment.verifyingContract) {
    return deployment.verifyingContract;
  }

  if (deployment.contract?.address) {
    return deployment.contract.address;
  }

  if (deployment.instance?.address) {
    return deployment.instance.address;
  }

  if (deployment.dex?.address) {
    return deployment.dex.address;
  }

  if (deployment.proxy?.address) {
    return deployment.proxy.address;
  }

  return '';
}

function extractDexAbi(deployment) {
  if (!deployment) {
    return [];
  }

  if (Array.isArray(deployment.abi)) {
    return deployment.abi;
  }

  if (Array.isArray(deployment.dex?.abi)) {
    return deployment.dex.abi;
  }

  if (Array.isArray(deployment.contract?.abi)) {
    return deployment.contract.abi;
  }

  if (Array.isArray(deployment.instance?.abi)) {
    return deployment.instance.abi;
  }

  if (Array.isArray(deployment.proxy?.abi)) {
    return deployment.proxy.abi;
  }

  return [];
}
const defaultRpcUrl =
  process.env.RPC_URL || process.env.JSON_RPC_URL || process.env[`${network.toUpperCase()}_RPC_URL`];
const defaultWsUrl = process.env.RPC_WS_URL || process.env.WS_RPC_URL || process.env.WS_URL;

const config = {
  projectRoot,
  env,
  isProduction: env === 'production',
  port: parseInteger(process.env.API_PORT || process.env.PORT, 4000),
  database: {
    url: process.env.DATABASE_URL || process.env.MONGODB_URI || '',
  },
  blockchain: {
    network,
    rpcUrl: defaultRpcUrl || '',
    wsUrl: defaultWsUrl || '',
    dexAddress: process.env.DEX_ADDRESS || extractDexAddress(dexDeployment),
    dexAbi: extractDexAbi(dexDeployment),
    privateKey: process.env.PRIVATE_KEY || '',
    confirmations: parseInteger(
      process.env.TX_CONFIRMATIONS || process.env.BLOCK_CONFIRMATIONS || '1',
      1,
    ),
    autoConnectSigner: parseBoolean(process.env.AUTO_CONNECT_SIGNER, true),
    mockTokenArtifact:
      process.env.MOCK_TOKEN_ARTIFACT_PATH ||
      path.join(projectRoot, 'artifacts', 'contracts', 'MockToken.sol', 'MockToken.json'),
  },
  events: {
    startBlock: parseInteger(process.env.EVENT_START_BLOCK, null),
    pollingInterval: parseInteger(process.env.EVENT_POLL_INTERVAL, 5000),
    batchSize: parseInteger(process.env.EVENT_BATCH_SIZE, 200),
    backfillOnStart: parseBoolean(process.env.EVENT_BACKFILL_ON_START, true),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  cors: {
    enabled: parseBoolean(process.env.CORS_ENABLED, true),
    origins:
      parseList(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS, [
        process.env.FRONTEND_URL,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ]).filter(Boolean),
    methods: parseList(
      process.env.CORS_ALLOWED_METHODS || process.env.CORS_METHODS,
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    ),
    allowedHeaders: parseList(process.env.CORS_ALLOWED_HEADERS, [
      'Content-Type',
      'Authorization',
      'Accept',
      'X-Requested-With',
    ]),
    exposedHeaders: parseList(process.env.CORS_EXPOSED_HEADERS, []),
    allowCredentials: parseBoolean(process.env.CORS_ALLOW_CREDENTIALS, false),
    maxAge: parseInteger(process.env.CORS_MAX_AGE, 86400),
  },
};

module.exports = config;
