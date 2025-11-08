const { ethers } = require('ethers');
const config = require('../config/config');
const blockchainService = require('./blockchain.service');
const logger = require('../utils/logger');

function serializeValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item));
  }
  if (value && typeof value === 'object') {
    if (typeof value.toHexString === 'function') {
      return value.toHexString();
    }
    const normalized = {};
    for (const [key, innerValue] of Object.entries(value)) {
      normalized[key] = serializeValue(innerValue);
    }
    return normalized;
  }
  return value;
}

function isNumericKey(key) {
  return typeof key === 'string' && /^\d+$/.test(key);
}

class EventListenerService {
  constructor() {
    this.contract = null;
    this.running = false;
    this.globalListeners = new Set();
    this.eventListeners = new Map();
    this.listenerHandles = new Map();
    this.pollTimer = null;
    this.lastProcessedBlock = null;
  }

  registerListener(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Listener callback must be a function');
    }
    this.globalListeners.add(callback);
    return () => {
      this.globalListeners.delete(callback);
    };
  }

  subscribe(eventName, callback) {
    if (!eventName) {
      throw new Error('Event name is required');
    }
    if (typeof callback !== 'function') {
      throw new Error('Listener callback must be a function');
    }

    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    const listeners = this.eventListeners.get(eventName);
    listeners.add(callback);

    if (this.running && this.contract && !this.listenerHandles.has(eventName)) {
      this._attachContractListener(eventName);
    }

    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this._detachContractListener(eventName);
        this.eventListeners.delete(eventName);
      }
    };
  }

  async emit(event) {
    if (!event || typeof event !== 'object') {
      throw new Error('Event payload must be an object');
    }
    return this._notify(event);
  }

  async start(options = {}) {
    if (this.running) {
      return this.contract;
    }

    try {
      this.contract = blockchainService.getDexContract();
    } catch (error) {
      logger.error('Failed to initialize DEX contract for event listener', {
        error: error.message,
      });
      throw error;
    }

    const provider = blockchainService.getProvider();
    if (!provider) {
      throw new Error('Blockchain provider is not initialized');
    }

    this.running = true;
    this.lastProcessedBlock =
      options.fromBlock ?? this._resolveStartingBlock() ?? (await provider.getBlockNumber());

    this._attachAllContractListeners();

    if (config.events.backfillOnStart !== false) {
      const backfillTo = options.toBlock ?? this.lastProcessedBlock;
      const backfillFrom = options.fromBlock ?? this._resolveStartingBlock();
      if (backfillFrom !== null && backfillFrom !== undefined && backfillFrom <= backfillTo) {
        await this.replay(backfillFrom, backfillTo);
      }
    }

    const shouldPoll =
      options.forcePolling ||
      (!options.disablePolling && this._providerRequiresPolling(provider));

    if (shouldPoll) {
      const interval = options.pollingInterval || config.events.pollingInterval || 5000;
      this.pollTimer = setInterval(() => {
        this._pollNewBlocks().catch((error) => {
          logger.error('Event polling failed', { error: error.message });
        });
      }, interval);
      if (typeof this.pollTimer.unref === 'function') {
        this.pollTimer.unref();
      }
    }

    return this.contract;
  }

  async stop() {
    if (!this.running) {
      return;
    }

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    for (const [eventName, handler] of this.listenerHandles.entries()) {
      try {
        if (typeof this.contract?.off === 'function') {
          this.contract.off(eventName, handler);
        } else if (typeof this.contract?.removeListener === 'function') {
          this.contract.removeListener(eventName, handler);
        }
      } catch (error) {
        logger.warn('Failed to detach contract listener', { eventName, error: error.message });
      }
    }

    this.listenerHandles.clear();
    this.contract = null;
    this.running = false;
    this.lastProcessedBlock = null;
  }

  async reset() {
    await this.stop();
    this.globalListeners.clear();
    this.eventListeners.clear();
  }

  async replay(fromBlock, toBlock) {
    if (!this.contract) {
      throw new Error('Event listener has not been started');
    }

    const provider = blockchainService.getProvider();
    if (!provider) {
      throw new Error('Blockchain provider is not initialized');
    }

    const endBlock = toBlock ?? (await provider.getBlockNumber());
    if (fromBlock > endBlock) {
      return [];
    }

    const eventsToReplay = new Set(this.eventListeners.keys());
    if (eventsToReplay.size === 0 && this.globalListeners.size > 0) {
      for (const eventName of this._getAbiEventNames()) {
        eventsToReplay.add(eventName);
      }
    }

    const dispatched = [];
    for (const eventName of eventsToReplay) {
      const filterFactory = this.contract.filters?.[eventName];
      if (typeof filterFactory !== 'function') {
        logger.warn('Unable to create filter for event', { eventName });
        continue;
      }
      const filter = filterFactory();
      const logs = await this.contract.queryFilter(filter, fromBlock, endBlock);
      for (const log of logs) {
        const payload = this._normalizeEvent(eventName, log);
        dispatched.push(payload);
        // eslint-disable-next-line no-await-in-loop
        await this._notify(payload);
      }
    }

    this.lastProcessedBlock = endBlock;
    return dispatched;
  }

  _resolveStartingBlock() {
    const { startBlock } = config.events;
    return Number.isInteger(startBlock) ? startBlock : null;
  }

  _providerRequiresPolling(provider) {
    return provider instanceof ethers.JsonRpcProvider && !(provider instanceof ethers.WebSocketProvider);
  }

  async _pollNewBlocks() {
    if (!this.running) {
      return;
    }

    const provider = blockchainService.getProvider();
    if (!provider) {
      return;
    }

    const latestBlock = await provider.getBlockNumber();
    if (this.lastProcessedBlock === null || this.lastProcessedBlock === undefined) {
      this.lastProcessedBlock = latestBlock;
      return;
    }

    if (latestBlock <= this.lastProcessedBlock) {
      return;
    }

    const fromBlock = this.lastProcessedBlock + 1;
    await this.replay(fromBlock, latestBlock);
  }

  _attachAllContractListeners() {
    if (!this.contract) {
      return;
    }

    const eventsToAttach = new Set(this.eventListeners.keys());
    if (eventsToAttach.size === 0 && this.globalListeners.size > 0) {
      for (const eventName of this._getAbiEventNames()) {
        eventsToAttach.add(eventName);
      }
    }

    for (const eventName of eventsToAttach) {
      this._attachContractListener(eventName);
    }
  }

  _attachContractListener(eventName) {
    if (!this.contract || this.listenerHandles.has(eventName)) {
      return;
    }

    const handler = (...rawArgs) => {
      const payload = this._normalizeEvent(eventName, rawArgs[rawArgs.length - 1], rawArgs);
      this._notify(payload).catch((error) => {
        logger.error('Failed to dispatch blockchain event', { eventName, error: error.message });
      });
    };

    try {
      this.contract.on(eventName, handler);
      this.listenerHandles.set(eventName, handler);
    } catch (error) {
      logger.warn('Failed to attach contract listener', { eventName, error: error.message });
    }
  }

  _detachContractListener(eventName) {
    if (!this.contract || !this.listenerHandles.has(eventName)) {
      return;
    }
    const handler = this.listenerHandles.get(eventName);
    try {
      if (typeof this.contract.off === 'function') {
        this.contract.off(eventName, handler);
      } else if (typeof this.contract.removeListener === 'function') {
        this.contract.removeListener(eventName, handler);
      }
    } catch (error) {
      logger.warn('Failed to detach contract listener', { eventName, error: error.message });
    }
    this.listenerHandles.delete(eventName);
  }

  _getAbiEventNames() {
    if (!this.contract?.interface?.fragments) {
      return [];
    }
    return this.contract.interface.fragments
      .filter((fragment) => fragment.type === 'event')
      .map((fragment) => fragment.name);
  }

  _normalizeEvent(eventName, payload, rawArgs = []) {
    let eventPayload = payload;
    if (Array.isArray(payload) || payload === undefined) {
      eventPayload = null;
    }

    const fragment = eventPayload?.fragment || eventPayload?.eventFragment || null;
    const argsSource = eventPayload?.args ?? (Array.isArray(rawArgs) ? rawArgs.slice(0, rawArgs.length - 1) : []);

    const args = this._normalizeArgs(argsSource, fragment);

    return {
      name: eventPayload?.eventName || eventPayload?.event || eventName,
      args,
      transactionHash: eventPayload?.log?.transactionHash || eventPayload?.transactionHash || null,
      blockNumber: eventPayload?.log?.blockNumber || eventPayload?.blockNumber || null,
      removed: eventPayload?.log?.removed || eventPayload?.removed || false,
      raw: eventPayload || rawArgs,
    };
  }

  _normalizeArgs(argsSource, fragment) {
    if (!argsSource) {
      return {};
    }

    if (Array.isArray(argsSource)) {
      const normalized = {};
      argsSource.forEach((value, index) => {
        const name = fragment?.inputs?.[index]?.name || String(index);
        normalized[name] = serializeValue(value);
      });
      return normalized;
    }

    if (typeof argsSource === 'object') {
      const normalized = {};
      for (const [key, value] of Object.entries(argsSource)) {
        if (isNumericKey(key)) {
          continue;
        }
        normalized[key] = serializeValue(value);
      }
      return normalized;
    }

    return { value: serializeValue(argsSource) };
  }

  async _notify(event) {
    const tasks = [];
    if (event?.name && this.eventListeners.has(event.name)) {
      for (const listener of this.eventListeners.get(event.name)) {
        tasks.push(
          Promise.resolve()
            .then(() => listener(event))
            .catch((error) => {
              logger.error('Event listener callback failed', {
                eventName: event.name,
                error: error.message,
              });
            }),
        );
      }
    }

    for (const listener of this.globalListeners) {
      tasks.push(
        Promise.resolve()
          .then(() => listener(event))
          .catch((error) => {
            logger.error('Global event listener callback failed', {
              eventName: event?.name,
              error: error.message,
            });
          }),
      );
    }

    await Promise.all(tasks);
    return event;
  }
}

module.exports = new EventListenerService();
