const crypto = require('crypto');
const { ethers } = require('ethers');
const Order = require('../models/Order');
const matchingService = require('./matching.service');
const settlementService = require('./settlement.service');
const orderBuilder = require('./order-builder.service');
const signatureUtils = require('../utils/signature');

function normalizeAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : value;
}

function toIsoOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

class OrderService {
  constructor() {
    this.orders = new Map();
  }

  async createOrder(orderInput) {
    const orderId = orderInput.id || this._generateOrderId();
    if (this.orders.has(orderId)) {
      throw new Error(`Order with id ${orderId} already exists`);
    }

    const signature = orderInput.signature || orderInput.onchain?.signature;
    if (!signature) {
      throw new Error('Order signature is required');
    }

    const prepared = await this.prepareOrder(orderInput, { includeRawTypedData: true });
    if (!prepared.rawTypedData || !prepared.rawOrder) {
      throw new Error('Unable to prepare raw typed data for signature verification');
    }

    const normalizedSignature = typeof signature === 'string' ? signature : String(signature);
    const expectedMaker = ethers.getAddress(prepared.trader);
    const recovered = signatureUtils.recoverOrderSigner(
      prepared.rawTypedData.domain,
      prepared.rawOrder,
      normalizedSignature,
    );

    if (ethers.getAddress(recovered) !== expectedMaker) {
      throw new Error('Signature does not match maker address');
    }

    const onchainPayload = {
      ...prepared.onchain,
      signature: normalizedSignature,
    };

    const metadata = {
      ...(orderInput.metadata || {}),
      ...prepared.metadata,
      typedData: prepared.typedData,
      orderHash: prepared.hash,
    };

    const order = new Order({
      ...orderInput,
      id: orderId,
      trader: expectedMaker,
      baseToken: prepared.baseToken,
      quoteToken: prepared.quoteToken,
      side: prepared.side,
      orderType: prepared.orderType,
      timeInForce: prepared.timeInForce,
      amount: prepared.amount,
      price: prepared.price,
      allowPartialFill: prepared.allowPartialFill,
      nonce: prepared.onchain.nonce,
      expiry: prepared.expiry,
      stopPrice: prepared.stopPrice,
      minFillAmount: prepared.minFillAmount,
      signature: normalizedSignature,
      onchain: onchainPayload,
      metadata,
    });

    this.orders.set(order.id, order);

    matchingService.addOrder(order);
    await this._settleOrderTrades(order);
    return order;
  }

  async prepareOrder(orderInput, options = {}) {
    const includeRaw = Boolean(options.includeRawTypedData);
    const prepared = await orderBuilder.prepare(orderInput, {
      includeTypedData: true,
      includeRawTypedData: includeRaw,
    });

    if (!includeRaw) {
      delete prepared.rawOrder;
      delete prepared.rawTypedData;
    }

    return prepared;
  }

  getOrder(id) {
    if (!id) {
      return null;
    }
    return this.orders.get(id) || null;
  }

  cancelOrder(id, reason = 'USER_CANCELLED') {
    const order = this.getOrder(id);
    if (!order) {
      return null;
    }

    if (['CANCELLED', 'FILLED', 'REJECTED', 'EXPIRED'].includes(order.status)) {
      return order;
    }

    matchingService.cancelOrder(order);
    order.cancel(reason);
    return order;
  }

  listOrders(filters = {}) {
    const { baseToken, quoteToken, trader, status } = filters;
    const normalizedBase = normalizeAddress(baseToken);
    const normalizedQuote = normalizeAddress(quoteToken);
    const normalizedTrader = normalizeAddress(trader);
    const normalizedStatus = typeof status === 'string' ? status.toUpperCase() : null;

    return Array.from(this.orders.values())
      .filter((order) => {
        if (normalizedBase && normalizeAddress(order.baseToken) !== normalizedBase) {
          return false;
        }
        if (normalizedQuote && normalizeAddress(order.quoteToken) !== normalizedQuote) {
          return false;
        }
        if (normalizedTrader && normalizeAddress(order.trader) !== normalizedTrader) {
          return false;
        }
        if (normalizedStatus && order.status !== normalizedStatus) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        if (Number.isNaN(timeA) || Number.isNaN(timeB)) {
          return 0;
        }
        return timeB - timeA;
      });
  }

  getOrderBook(baseToken, quoteToken) {
    const book = matchingService.getOrderBook(baseToken, quoteToken);

    if (baseToken && quoteToken) {
      return this._serializeOrderBook(book);
    }

    const serialized = {};
    for (const [pairKey, pairBook] of Object.entries(book)) {
      serialized[pairKey] = this._serializeOrderBook(pairBook);
    }
    return serialized;
  }

  getRecentTrades(baseToken, quoteToken, limit = 50) {
    if (!baseToken || !quoteToken) {
      return [];
    }
    return matchingService.getRecentTrades(baseToken, quoteToken, limit).map((trade) => ({
      ...trade,
      timestamp: toIsoOrNull(trade.timestamp),
    }));
  }

  updateMarketPrice(baseToken, quoteToken, price) {
    matchingService.updateMarketPrice(baseToken, quoteToken, price);
    return matchingService.getMarketPrice(baseToken, quoteToken);
  }

  getMarketPrice(baseToken, quoteToken) {
    return matchingService.getMarketPrice(baseToken, quoteToken);
  }

  async executeBatch(orderIds, options = {}) {
    if (!Array.isArray(orderIds) || orderIds.length < 2) {
      throw new Error('orderIds must include at least two entries for batch execution');
    }

    const orders = orderIds.map((id) => {
      const order = this.getOrder(id);
      if (!order) {
        throw new Error(`Order ${id} not found`);
      }
      return order;
    });

    const result = matchingService.executeBatchTrades(orders, options);
    const enrichedTrades = await Promise.all(
      result.trades.map(async (trade) => {
        const makerOrder = this.getOrder(trade.makerOrderId);
        const takerOrder = this.getOrder(trade.takerOrderId);
        try {
          const settlement = await settlementService.settleTrade({
            trade,
            makerOrder,
            takerOrder,
          });
          return { ...trade, settlement };
        } catch (error) {
          return {
            ...trade,
            settlement: {
              success: false,
              error: error.message,
            },
          };
        }
      }),
    );

    return {
      batchId: result.batchId,
      trades: enrichedTrades.map((trade) => ({
        ...trade,
        timestamp: toIsoOrNull(trade.timestamp),
      })),
      orders: result.orders.map((order) => this.toJSON(order)),
      offerAmounts: result.offerAmounts,
      requestAmounts: result.requestAmounts,
    };
  }

  toJSON(order) {
    if (!order) {
      return null;
    }
    return order.toJSON();
  }

  _generateOrderId() {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
  }

  _serializeOrderBook(book) {
    if (!book) {
      return {
        buy: [],
        sell: [],
        stopLoss: [],
        stopLimit: [],
        trades: [],
      };
    }

    return {
      buy: book.buy.map((order) => (typeof order.toJSON === 'function' ? order.toJSON() : order)),
      sell: book.sell.map((order) => (typeof order.toJSON === 'function' ? order.toJSON() : order)),
      stopLoss: book.stopLoss.map((order) => (typeof order.toJSON === 'function' ? order.toJSON() : order)),
      stopLimit: book.stopLimit.map((order) => (typeof order.toJSON === 'function' ? order.toJSON() : order)),
      trades: book.trades.map((trade) => ({
        ...trade,
        timestamp: toIsoOrNull(trade.timestamp),
      })),
    };
  }

  async _settleOrderTrades(order) {
    if (!order?.metadata || !Array.isArray(order.metadata.trades)) {
      return [];
    }

    const outcomes = [];
    for (const trade of order.metadata.trades) {
      if (trade.synthetic) {
        trade.settlement = {
          success: true,
          synthetic: true,
          reason: 'synthetic_liquidity',
        };
        outcomes.push(trade.settlement);
        continue;
      }
      const makerOrder = this.getOrder(trade.makerOrderId);
      const takerOrder = this.getOrder(trade.takerOrderId);
      if (!makerOrder || !takerOrder) {
        trade.settlement = {
          success: false,
          error: 'Unable to resolve maker or taker order for settlement',
        };
        outcomes.push(trade.settlement);
        continue;
      }

      try {
        const settlement = await settlementService.settleTrade({
          trade,
          makerOrder,
          takerOrder,
        });
        trade.settlement = settlement;
        outcomes.push(settlement);
      } catch (error) {
        trade.settlement = {
          success: false,
          error: error.message,
        };
        outcomes.push(trade.settlement);
      }
    }

    return outcomes;
  }
}

module.exports = new OrderService();
