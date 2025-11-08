const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const config = require('../config/config');
const logger = require('../utils/logger');

const MINIMAL_ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
];

function normalizeWholeTokenAmount(value, { fieldName = 'value' } = {}) {
  if (value === undefined || value === null || value === '') {
    return 0n;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${fieldName} must be a finite number`);
    }
    return BigInt(Math.trunc(value));
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return 0n;
    }
    if (!/^[-+]?\d+$/.test(normalized)) {
      throw new Error(`${fieldName} must be an integer string`);
    }
    return BigInt(normalized);
  }

  throw new Error(`${fieldName} must be numeric`);
}

function loadArtifact(artifactPath) {
  if (!artifactPath) {
    throw new Error('Mock token artifact path is not configured');
  }

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found at ${artifactPath}`);
  }

  const contents = fs.readFileSync(artifactPath, 'utf8');
  const artifact = JSON.parse(contents);
  if (!artifact?.abi || !artifact?.bytecode) {
    throw new Error('Artifact must include abi and bytecode');
  }
  return artifact;
}

function serializeError(error) {
  if (!error) {
    return {};
  }
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'object') {
    return error;
  }
  return { message: String(error) };
}

class BlockchainService {
  constructor(provider = null, signer = null) {
    this.provider = provider || null;
    this.signer = signer || null;
    this.dexAddress = config.blockchain.dexAddress;
    this.dexAbi = Array.isArray(config.blockchain.dexAbi) ? config.blockchain.dexAbi : [];
    this.confirmations = config.blockchain.confirmations || 1;
    this.autoConnectSigner = config.blockchain.autoConnectSigner !== false;
    this.contractCache = new Map();
    this.chainId = null;

    if (!this.provider) {
      this._initializeProvider();
    }

    if (this.autoConnectSigner && !this.signer && config.blockchain.privateKey) {
      this._initializeSigner(config.blockchain.privateKey);
    }

    if (!this.dexAbi.length) {
      this.dexAbi = this._loadDexAbiFallback();
    }
  }

  _initializeProvider() {
    const { rpcUrl, wsUrl } = config.blockchain;

    if (wsUrl) {
      try {
        this.provider = new ethers.WebSocketProvider(wsUrl);
        return this.provider;
      } catch (error) {
        logger.warn('Failed to initialize websocket provider', serializeError(error));
      }
    }

    if (rpcUrl) {
      try {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        return this.provider;
      } catch (error) {
        logger.error('Failed to initialize JSON RPC provider', serializeError(error));
      }
    }

    this.provider = null;
    return null;
  }

  _initializeSigner(privateKey) {
    if (!privateKey) {
      return null;
    }

    try {
      const provider = this.getProvider();
      this.signer = provider ? new ethers.Wallet(privateKey, provider) : new ethers.Wallet(privateKey);
      return this.signer;
    } catch (error) {
      logger.error('Failed to initialize signer', serializeError(error));
      this.signer = null;
      return null;
    }
  }

  _loadDexAbiFallback() {
    const baseDir = config.projectRoot || process.cwd();
    const artifactCandidates = [
      path.join(baseDir, 'artifacts', 'contracts', 'DEX.sol', 'DEX.json'),
      path.join(baseDir, 'artifacts', 'contracts', 'DEX_Extended.sol', 'DEX_Extended.json'),
    ];

    for (const candidate of artifactCandidates) {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      try {
        const content = fs.readFileSync(candidate, 'utf8');
        const artifact = JSON.parse(content);
        if (artifact?.abi) {
          return artifact.abi;
        }
      } catch (error) {
        logger.warn('Unable to parse ABI artifact', { candidate, ...serializeError(error) });
      }
    }

    return [];
  }

  setProvider(provider) {
    this.provider = provider || null;
    if (this.signer && provider) {
      this.signer = this.signer.connect(provider);
    }
    this.contractCache.clear();
    this.chainId = null;
    return this.provider;
  }

  getProvider() {
    if (!this.provider) {
      this._initializeProvider();
    }
    return this.provider;
  }

  setSigner(signer) {
    this.signer = signer || null;
    this.contractCache.clear();
    return this.signer;
  }

  connectWallet(privateKey) {
    return this._initializeSigner(privateKey);
  }

  getSigner() {
    if (!this.signer && this.autoConnectSigner && config.blockchain.privateKey) {
      this._initializeSigner(config.blockchain.privateKey);
    }
    return this.signer;
  }

  async getChainId(force = false) {
    if (!force && this.chainId) {
      return this.chainId;
    }

    const provider = this.getProvider();
    if (!provider) {
      return null;
    }

    try {
      if (provider._network && provider._network.chainId) {
        this.chainId = Number(provider._network.chainId);
        return this.chainId;
      }

      if (typeof provider.getNetwork === 'function') {
        const network = await provider.getNetwork();
        if (network?.chainId !== undefined) {
          this.chainId = Number(network.chainId);
          return this.chainId;
        }
      }
    } catch (error) {
      logger.warn('Failed to resolve chainId from provider', serializeError(error));
    }

    return null;
  }

  setDexAddress(address) {
    this.dexAddress = address || '';
    this.contractCache.delete('dex');
  }

  setDexAbi(abi) {
    this.dexAbi = Array.isArray(abi) ? abi : [];
    this.contractCache.delete('dex');
  }

  getDexAddress() {
    return this.dexAddress;
  }

  getDexContract(forceReload = false) {
    if (!this.dexAddress) {
      throw new Error('DEX contract address is not configured');
    }
    if (!this.dexAbi || this.dexAbi.length === 0) {
      throw new Error('DEX contract ABI is not available');
    }

    if (!forceReload && this.contractCache.has('dex')) {
      return this.contractCache.get('dex');
    }

    const connection = this.getSigner() || this.getProvider();
    if (!connection) {
      throw new Error('Blockchain provider is not initialized');
    }

    const contract = new ethers.Contract(this.dexAddress, this.dexAbi, connection);
    this.contractCache.set('dex', contract);
    return contract;
  }

  getContract(address, abi, { cacheKey = null, forceReload = false } = {}) {
    if (!address) {
      throw new Error('Contract address is required');
    }
    if (!abi || !Array.isArray(abi) || abi.length === 0) {
      throw new Error('Contract ABI is required');
    }

    if (!forceReload && cacheKey && this.contractCache.has(cacheKey)) {
      return this.contractCache.get(cacheKey);
    }

    const connection = this.getSigner() || this.getProvider();
    if (!connection) {
      throw new Error('Blockchain provider is not initialized');
    }

    const contract = new ethers.Contract(address, abi, connection);
    if (cacheKey) {
      this.contractCache.set(cacheKey, contract);
    }
    return contract;
  }

  async getBlockNumber() {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('Blockchain provider is not initialized');
    }
    return provider.getBlockNumber();
  }

  async getBlock(blockNumber) {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('Blockchain provider is not initialized');
    }
    return provider.getBlock(blockNumber);
  }

  async waitForTransaction(hash, confirmations = this.confirmations) {
    const provider = this.getProvider();
    if (!provider) {
      throw new Error('Blockchain provider is not initialized');
    }
    return provider.waitForTransaction(hash, confirmations);
  }

  async callDex(methodName, params = []) {
    const contract = this.getDexContract();
    if (typeof contract[methodName] !== 'function') {
      throw new Error(`Method ${methodName} does not exist on DEX contract`);
    }
    return contract[methodName](...params);
  }

  async sendDexTransaction(methodName, params = [], overrides = {}) {
    const contract = this.getDexContract();
    const signer = this.getSigner();
    if (!signer) {
      throw new Error('A signer is required to execute transactions');
    }
    if (typeof contract[methodName] !== 'function') {
      throw new Error(`Method ${methodName} does not exist on DEX contract`);
    }

    const populatedContract = contract.connect(signer);
    const tx = await populatedContract[methodName](...params, overrides);
    return tx.wait(this.confirmations);
  }

  async getDexBalance(userAddress, tokenAddress) {
    if (!userAddress || !tokenAddress) {
      throw new Error('User address and token address are required');
    }
    const contract = this.getDexContract();
    const balance = await contract.balanceOf(userAddress, tokenAddress);
    return balance ? balance.toString() : '0';
  }

  async getTokenBalance(tokenAddress, userAddress) {
    if (!tokenAddress || !userAddress) {
      throw new Error('Token address and user address are required');
    }
    const contract = this.getContract(tokenAddress, MINIMAL_ERC20_ABI, {
      cacheKey: `erc20:${tokenAddress}`,
    });
    const balance = await contract.balanceOf(userAddress);
    return balance ? balance.toString() : '0';
  }

  getErc20Contract(tokenAddress, { signer = null, cacheKey = true } = {}) {
    if (!tokenAddress) {
      throw new Error('Token address is required');
    }
    const contract = this.getContract(tokenAddress, MINIMAL_ERC20_ABI, {
      cacheKey: cacheKey ? `erc20:${tokenAddress}` : null,
    });
    if (signer) {
      return contract.connect(signer);
    }
    return contract;
  }

  async getErc20Metadata(tokenAddress) {
    if (!tokenAddress) {
      throw new Error('Token address is required');
    }
    const contract = this.getContract(tokenAddress, MINIMAL_ERC20_ABI, {
      cacheKey: `erc20:${tokenAddress}`,
    });
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      contract.name().catch(() => ''),
      contract.symbol().catch(() => ''),
      contract.decimals().catch(() => 18),
      contract.totalSupply().catch(() => null),
    ]);
    return {
      name,
      symbol,
      decimals: Number(decimals),
      totalSupply: totalSupply ? totalSupply.toString() : null,
    };
  }

  async deployMockToken({ name, symbol, initialSupply = 0, recipient, artifactPath } = {}) {
    const signer = this.getSigner();
    if (!signer) {
      throw new Error('A signer is required to deploy tokens');
    }

    const normalizedSupply = normalizeWholeTokenAmount(initialSupply, {
      fieldName: 'initialSupply',
    });
    if (normalizedSupply < 0n) {
      throw new Error('initialSupply cannot be negative');
    }

    const resolvedArtifactPath =
      artifactPath || config.blockchain.mockTokenArtifact || '<<SET_MOCK_TOKEN_ARTIFACT_PATH>>';
    const artifact = loadArtifact(resolvedArtifactPath);
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);

    const contract = await factory.deploy(name, symbol, normalizedSupply);
    const deploymentTx = contract.deploymentTransaction();
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    let decimals = 18;
    try {
      decimals = await contract.decimals();
    } catch (error) {
      logger.warn('Unable to read decimals from deployed token', serializeError(error));
    }

    if (recipient && recipient !== (await signer.getAddress())) {
      try {
        const amount = normalizedSupply * 10n ** BigInt(decimals);
        if (amount > 0n) {
          const transferTx = await contract.transfer(recipient, amount);
          await transferTx.wait(this.confirmations);
        }
      } catch (error) {
        logger.warn('Failed to transfer initial supply to recipient', serializeError(error));
        throw new Error(
          `Initial supply transfer failed: ${error?.message || 'unknown blockchain error'}`,
        );
      }
    }

    let totalSupply = null;
    try {
      const supply = await contract.totalSupply();
      totalSupply = supply.toString();
    } catch (error) {
      logger.warn('Unable to read total supply from deployed token', serializeError(error));
    }

    return {
      address: contractAddress,
      name,
      symbol,
      decimals: Number(decimals),
      totalSupply,
      issuer: await signer.getAddress(),
      transactionHash: deploymentTx?.hash || '',
    };
  }

  async disconnect() {
    if (this.provider && typeof this.provider.destroy === 'function') {
      try {
        await this.provider.destroy();
      } catch (error) {
        logger.warn('Failed to cleanly disconnect provider', serializeError(error));
      }
    }
    this.provider = null;
    this.signer = null;
    this.contractCache.clear();
  }
}

module.exports = new BlockchainService();
