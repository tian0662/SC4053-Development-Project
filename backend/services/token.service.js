const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const JsonStore = require('../utils/json-store');
const blockchainService = require('./blockchain.service');
const logger = require('../utils/logger');
const config = require('../config/config');

function normalizeAddress(address) {
  if (!address) {
    return '';
  }
  try {
    return ethers.getAddress(address);
  } catch (error) {
    return address.toLowerCase();
  }
}

class TokenService {
  constructor() {
    this.store = new JsonStore('tokens.json', { defaultValue: [] });
    this.tokens = new Map();
    this._loadFromStore();
    this._loadFromDeployments();
  }

  _loadFromStore() {
    const storedTokens = this.store.getAll();
    if (!Array.isArray(storedTokens)) {
      return;
    }
    storedTokens.forEach((token) => {
      if (token?.address) {
        this.tokens.set(normalizeAddress(token.address), token);
      }
    });
  }

  _persist() {
    const allTokens = Array.from(this.tokens.values()).map((token) => ({ ...token }));
    this.store.setAll(allTokens);
  }

  _loadFromDeployments() {
    if (this.tokens.size > 0) {
      return;
    }

    const deployment = this._readDeploymentTokens();
    if (!deployment?.tokens || typeof deployment.tokens !== 'object') {
      return;
    }

    Object.values(deployment.tokens).forEach((tokenConfig) => {
      if (!tokenConfig?.address) {
        return;
      }

      const normalized = normalizeAddress(tokenConfig.address);
      if (this.tokens.has(normalized)) {
        return;
      }

      const token = {
        address: normalized,
        symbol: tokenConfig.symbol || '',
        name: tokenConfig.name || '',
        decimals:
          tokenConfig.decimals !== undefined && tokenConfig.decimals !== null
            ? Number(tokenConfig.decimals)
            : null,
        issuer: tokenConfig.issuer || deployment.deployer || '',
        totalSupply:
          tokenConfig.totalSupply !== undefined && tokenConfig.totalSupply !== null
            ? String(tokenConfig.totalSupply)
            : tokenConfig.initialSupply !== undefined && tokenConfig.initialSupply !== null
            ? String(tokenConfig.initialSupply)
            : null,
        description: tokenConfig.description || '',
        registeredAt: deployment.deployedAt || new Date().toISOString(),
      };

      this.tokens.set(normalized, token);
    });

    if (this.tokens.size > 0) {
      this._persist();
    }
  }

  _readDeploymentTokens() {
    const network = config?.blockchain?.network || 'localhost';
    const deploymentDir = path.join(process.cwd(), 'deployments');
    const candidates = [`tokens-${network}.json`, 'tokens.json'];

    for (const candidate of candidates) {
      const filePath = path.join(deploymentDir, candidate);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        const contents = fs.readFileSync(filePath, 'utf8');
        if (!contents.trim()) {
          continue;
        }
        return JSON.parse(contents);
      } catch (error) {
        logger.warn('Failed to parse deployment tokens file', {
          filePath,
          error: error.message,
        });
      }
    }

    return null;
  }

  listTokens() {
    return Array.from(this.tokens.values()).map((token) => ({ ...token }));
  }

  getToken(address) {
    if (!address) {
      return null;
    }
    return this.tokens.get(normalizeAddress(address)) || null;
  }

  async ensureTokenMetadata(address) {
    const normalized = normalizeAddress(address);
    if (!normalized) {
      throw new Error('Token address is required');
    }

    const existing = this.getToken(normalized);
    if (existing?.symbol) {
      return existing;
    }

    try {
      const metadata = await blockchainService.getErc20Metadata(normalized);
      const token = { address: normalized, ...metadata };
      this.tokens.set(normalized, token);
      this._persist();
      return token;
    } catch (error) {
      logger.warn('Failed to fetch token metadata', { address: normalized, error: error.message });
      const fallback = { address: normalized };
      this.tokens.set(normalized, fallback);
      this._persist();
      return fallback;
    }
  }

  registerToken(tokenInput) {
    const {
      address,
      symbol,
      name,
      decimals,
      issuer,
      totalSupply,
      description,
    } = tokenInput || {};

    if (!address) {
      throw new Error('Token address is required');
    }

    const normalized = normalizeAddress(address);
    if (this.tokens.has(normalized)) {
      throw new Error('Token already registered');
    }

    const token = {
      address: normalized,
      symbol: symbol || '',
      name: name || '',
      decimals: decimals !== undefined ? Number(decimals) : null,
      issuer: issuer || '',
      totalSupply: totalSupply !== undefined ? String(totalSupply) : null,
      description: description || '',
      registeredAt: new Date().toISOString(),
    };

    this.tokens.set(normalized, token);
    this._persist();
    return token;
  }

  async issueToken(params = {}) {
    const { name, symbol, initialSupply, recipient, artifactPath } = params;
    if (!name || !symbol) {
      throw new Error('Token name and symbol are required');
    }

    const deployment = await blockchainService.deployMockToken({
      name,
      symbol,
      initialSupply,
      recipient,
      artifactPath,
    });

    const token = {
      address: deployment.address,
      name: deployment.name || name,
      symbol: deployment.symbol || symbol,
      decimals: deployment.decimals ?? 18,
      issuer: deployment.issuer || (await blockchainService.getSigner()?.getAddress?.()),
      totalSupply: deployment.totalSupply || null,
      transactionHash: deployment.transactionHash || '',
      registeredAt: new Date().toISOString(),
    };

    this.tokens.set(normalizeAddress(token.address), token);
    this._persist();
    return token;
  }
}

module.exports = new TokenService();
