const ORDER_TYPES = {
  LIMIT: 'LIMIT',
  MARKET: 'MARKET',
  STOP_LOSS: 'STOP_LOSS',
  STOP_LIMIT: 'STOP_LIMIT',
};

const TIME_IN_FORCE = {
  GTC: 'GTC',
  IOC: 'IOC',
  FOK: 'FOK',
  POST_ONLY: 'POST_ONLY',
};

const crypto = require('crypto');
const priceOracleService = require('./price-oracle.service');

const SYNTHETIC_COUNTERPARTY_PREFIX = 'synthetic-liquidity';
const MARKET_BUY_PRICE_IMPACT_RATE = 1;

class MatchingService {
  constructor() {
    this.orderBooks = new Map();
    this.marketPrices = new Map();
    this.marketPriceMeta = new Map();
    this.maxTradeHistory = 200;
  }

  addOrder(order) {
    if (!order || !order.baseToken || !order.quoteToken) {
      throw new Error('Order must include baseToken and quoteToken');
    }

    order.orderType = (order.orderType || ORDER_TYPES.LIMIT).toUpperCase();
    order.timeInForce = (order.timeInForce || TIME_IN_FORCE.GTC).toUpperCase();
    order.side = String(order.side || (order.isSell && order.isSell() ? 'SELL' : 'BUY')).toUpperCase();

    const pairKey = this._getPairKey(order.baseToken, order.quoteToken);
    const book = this._getOrCreateOrderBook(pairKey);

    let trades = [];
    switch (order.orderType) {
      case ORDER_TYPES.MARKET:
        trades = this._handleMarketOrder(order, book, pairKey);
        break;
      case ORDER_TYPES.STOP_LOSS:
        trades = this._queueStopOrder(order, book, 'stopLoss', pairKey);
        break;
      case ORDER_TYPES.STOP_LIMIT:
        trades = this._queueStopOrder(order, book, 'stopLimit', pairKey);
        break;
      case ORDER_TYPES.LIMIT:
      default:
        trades = this._handleLimitOrder(order, book, pairKey);
        break;
    }

    if (trades.length) {
      order.metadata = order.metadata || {};
      order.metadata.trades = trades;
    }

    return order;
  }

  updateMarketPrice(baseToken, quoteToken, price) {
    const pairKey = this._getPairKey(baseToken, quoteToken);
    const numericPrice = Number(price);
    if (Number.isNaN(numericPrice) || numericPrice <= 0) {
      throw new Error('Invalid market price');
    }
    this._updateMarketPriceInternal(pairKey, numericPrice, { source: 'external' });
  }

  getMarketPrice(baseToken, quoteToken) {
    if (!baseToken || !quoteToken) {
      return null;
    }
    const pairKey = this._getPairKey(baseToken, quoteToken);
    return this.marketPrices.get(pairKey) || null;
  }

  getMarketPriceSnapshot(baseToken, quoteToken) {
    if (!baseToken || !quoteToken) {
      return null;
    }
    const pairKey = this._getPairKey(baseToken, quoteToken);
    return this.getMarketPriceSnapshotFromKey(pairKey);
  }

  getMarketPriceSnapshotFromKey(pairKey) {
    if (!pairKey || !this.marketPrices.has(pairKey)) {
      return null;
    }
    const price = this.marketPrices.get(pairKey);
    const meta = this.marketPriceMeta.get(pairKey) || {};
    const source = meta.source || 'unknown';
    const updatedAt = meta.updatedAt instanceof Date && !Number.isNaN(meta.updatedAt.getTime())
      ? meta.updatedAt
      : null;
    const previousPrice = Number.isFinite(meta.previousPrice) && meta.previousPrice > 0
      ? meta.previousPrice
      : null;
    return {
      price,
      source,
      updatedAt,
      previousPrice,
    };
  }

  getRecentTrades(baseToken, quoteToken, limit = 50) {
    const pairKey = this._getPairKey(baseToken, quoteToken);
    const book = this.orderBooks.get(pairKey);
    if (!book) {
      return [];
    }
    if (typeof limit !== 'number' || limit <= 0) {
      return [...book.trades];
    }
    return book.trades.slice(-limit);
  }

  cancelOrder(order) {
    if (!order) {
      return false;
    }
    const pairKey = this._getPairKey(order.baseToken, order.quoteToken);
    const book = this.orderBooks.get(pairKey);
    if (!book) {
      return false;
    }

    let removed = false;
    removed = this._removeOrderFromList(book.buy, order.id) || removed;
    removed = this._removeOrderFromList(book.sell, order.id) || removed;
    removed = this._removeOrderFromList(book.stopLoss, order.id) || removed;
    removed = this._removeOrderFromList(book.stopLimit, order.id) || removed;
    return removed;
  }

  executeBatchTrades(orderList, options = {}) {
    if (!Array.isArray(orderList) || orderList.length < 2) {
      throw new Error('Batch execution requires at least two orders');
    }

    const tolerance = typeof options.tolerance === 'number' ? Math.abs(options.tolerance) : 1e-8;
    const normalizedOrders = orderList.map((order, index) => this._normalizeBatchOrder(order, index));

    for (let i = 0; i < normalizedOrders.length; i += 1) {
      const current = normalizedOrders[i];
      const next = normalizedOrders[(i + 1) % normalizedOrders.length];
      if (current.requestToken !== next.offerToken) {
        throw new Error('Batch orders must form a closed token loop');
      }
    }

    const totalRate = normalizedOrders.reduce((acc, entry) => acc * entry.rate, 1);
    if (!Number.isFinite(totalRate) || totalRate <= 0) {
      throw new Error('Batch orders produce an invalid aggregate conversion rate');
    }
    if (Math.abs(totalRate - 1) > tolerance) {
      throw new Error('Batch orders do not balance; aggregate conversion rate must be 1');
    }

    let maxOffer = normalizedOrders[0].offerRemaining;
    if (!(maxOffer > 0)) {
      throw new Error('Batch execution requires remaining liquidity');
    }

    let cumulativeRate = 1;
    for (let i = 1; i < normalizedOrders.length; i += 1) {
      cumulativeRate *= normalizedOrders[i - 1].rate;
      const candidate = normalizedOrders[i].offerRemaining / cumulativeRate;
      if (!(candidate > 0)) {
        throw new Error('Batch execution lacks sufficient liquidity');
      }
      maxOffer = Math.min(maxOffer, candidate);
    }

    if (!(maxOffer > 0)) {
      throw new Error('Batch execution lacks sufficient liquidity');
    }

    const offerAmounts = new Array(normalizedOrders.length).fill(0);
    const requestAmounts = new Array(normalizedOrders.length).fill(0);
    offerAmounts[0] = maxOffer;

    for (let i = 0; i < normalizedOrders.length; i += 1) {
      const entry = normalizedOrders[i];
      const offerAmount = offerAmounts[i];
      if (!(offerAmount > 0)) {
        throw new Error('Batch execution amount must be positive');
      }

      requestAmounts[i] = offerAmount * entry.rate;
      const nextIndex = (i + 1) % normalizedOrders.length;
      if (nextIndex !== 0) {
        offerAmounts[nextIndex] = requestAmounts[i];
      }
    }

    const finalRequest = requestAmounts[requestAmounts.length - 1];
    if (Math.abs(finalRequest - offerAmounts[0]) > tolerance) {
      throw new Error('Batch orders cannot settle without imbalance');
    }

    const batchId = this._generateBatchId();
    const trades = [];
    const timestamp = new Date();

    for (let i = 0; i < normalizedOrders.length; i += 1) {
      const entry = normalizedOrders[i];
      const nextEntry = normalizedOrders[(i + 1) % normalizedOrders.length];
      const offerAmount = offerAmounts[i];
      const requestAmount = requestAmounts[i];

      const baseFilled = entry.isSell ? offerAmount : requestAmount;
      if (baseFilled > entry.order.remaining + tolerance) {
        throw new Error('Batch execution overfills an order');
      }
      if (entry.allowPartialFill === false && Math.abs(baseFilled - entry.order.remaining) > tolerance) {
        throw new Error('Batch execution would only partially fill an all-or-nothing order');
      }

      const execution = entry.order.recordFill(baseFilled, entry.price, nextEntry.order.id, timestamp);
      if (execution) {
        execution.batchId = batchId;
        execution.offerAmount = offerAmount;
        execution.receiveAmount = requestAmount;
      }

      entry.order.metadata = entry.order.metadata || {};
      if (!Array.isArray(entry.order.metadata.batchExecutions)) {
        entry.order.metadata.batchExecutions = [];
      }
      entry.order.metadata.batchExecutions.push({
        batchId,
        index: i,
        offerToken: entry.offerTokenRaw,
        requestToken: entry.requestTokenRaw,
        offerAmount,
        receiveAmount: requestAmount,
        executedAt: timestamp,
      });

      const tradeRecord = {
        price: entry.price,
        amount: baseFilled,
        fillAmount: baseFilled,
        buyOrderId: entry.order.isBuy() ? entry.order.id : nextEntry.order.id,
        sellOrderId: entry.order.isSell() ? entry.order.id : nextEntry.order.id,
        makerOrderId: entry.order.id,
        takerOrderId: nextEntry.order.id,
        timestamp,
        batchId,
      };
      trades.push(tradeRecord);

      const pairKey = this._getPairKey(entry.order.baseToken, entry.order.quoteToken);
      this._recordTrade(pairKey, tradeRecord);
      this._updateMarketPriceInternal(pairKey, entry.price, { source: 'batch' });
      priceOracleService.registerTrade(entry.order.baseToken, entry.order.quoteToken, {
        price: entry.price,
        baseAmount: baseFilled,
        quoteAmount: baseFilled * entry.price,
        side: entry.order.isSell() ? 'SELL' : 'BUY',
        source: 'batch',
      });

      if (entry.order.remaining <= tolerance) {
        this._cleanupOrderFromBooks(entry.order);
      }
    }

    return {
      batchId,
      offerAmounts,
      requestAmounts,
      trades,
      orders: normalizedOrders.map((entry) => entry.order),
    };
  }

  getOrderBook(baseToken, quoteToken) {
    if (baseToken && quoteToken) {
      const pairKey = this._getPairKey(baseToken, quoteToken);
      const book = this.orderBooks.get(pairKey);
      return book ? this._cloneBook(book) : this._emptyBook();
    }

    const snapshot = {};
    for (const [pairKey, book] of this.orderBooks.entries()) {
      snapshot[pairKey] = this._cloneBook(book);
    }
    return snapshot;
  }

  _handleLimitOrder(order, book, pairKey) {
    const restingMarketOpposite = order.isBuy() ? book.marketSell : book.marketBuy;
    const trades = [];

    if (restingMarketOpposite.length > 0) {
      trades.push(...this._matchOrder(pairKey, order, restingMarketOpposite, () => true));
    }

    const opposite = order.isBuy() ? book.sell : book.buy;
    const priceCondition = order.isBuy()
      ? (maker) => maker.price !== null && maker.price <= order.price
      : (maker) => maker.price !== null && maker.price >= order.price;

    if (order.timeInForce === TIME_IN_FORCE.POST_ONLY) {
      const bestOpposite = opposite[0];
      if (bestOpposite && priceCondition(bestOpposite)) {
        order.metadata = order.metadata || {};
        order.metadata.rejectReason = 'POST_ONLY_WOULD_TRADE';
        order.status = 'REJECTED';
        return [];
      }
    }

    if (order.timeInForce === TIME_IN_FORCE.FOK || order.allowPartialFill === false) {
      const fillableFromResting = this._calculateFillableVolume(restingMarketOpposite, () => true);
      const fillableFromOpposite = this._calculateFillableVolume(opposite, priceCondition);
      const totalFillable = fillableFromResting + fillableFromOpposite;
      if (totalFillable < order.remaining) {
        order.metadata = order.metadata || {};
        order.metadata.rejectReason = 'INSUFFICIENT_LIQUIDITY';
        order.metadata.availableVolume = totalFillable;
        order.status = 'REJECTED';
        return [];
      }
    }

    trades.push(...this._matchOrder(pairKey, order, opposite, priceCondition));

    if (order.remaining > 0) {
      if (order.timeInForce === TIME_IN_FORCE.IOC) {
        order.metadata = order.metadata || {};
        order.metadata.unfilledAmount = order.remaining;
        order.metadata.cancelReason = 'IOC_UNFILLED';
        order.status = order.filled > 0 ? 'PARTIAL' : 'REJECTED';
      } else if (order.timeInForce === TIME_IN_FORCE.FOK || order.allowPartialFill === false) {
        order.metadata = order.metadata || {};
        order.metadata.unfilledAmount = order.remaining;
        order.status = order.filled > 0 ? 'PARTIAL' : 'REJECTED';
      } else {
        this._restOnBook(order, order.isBuy() ? book.buy : book.sell, order.side);
      }
    } else {
      order.status = 'FILLED';
    }

    return trades;
  }

  _resolveOrderPrice(order) {
    if (!order) {
      return null;
    }
    const direct = Number(order.price);
    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }
    const metadataPrice = Number(order.metadata?.price);
    if (Number.isFinite(metadataPrice) && metadataPrice > 0) {
      return metadataPrice;
    }
    return null;
  }

  _shouldUseSyntheticLiquidity(order) {
    if (!order || order.orderType !== ORDER_TYPES.MARKET) {
      return false;
    }

    const price = this._resolveOrderPrice(order);
    if (!Number.isFinite(price) || price <= 0) {
      return false;
    }

    const metadataSource = order.metadata?.priceSource;
    if (metadataSource && String(metadataSource).toLowerCase() === 'synthetic') {
      return true;
    }

    const pairKey = this._getPairKey(order.baseToken, order.quoteToken);
    const marketMeta = this.marketPriceMeta.get(pairKey);
    if (marketMeta && String(marketMeta.source || '').toLowerCase() === 'synthetic') {
      return true;
    }

    return false;
  }

  _fillWithSyntheticLiquidity(order, pairKey) {
    const price = this._resolveOrderPrice(order);
    const baseRemaining = order?.remaining ?? 0;
    if (!Number.isFinite(price) || price <= 0 || !(baseRemaining > 0)) {
      return null;
    }

    const timestamp = new Date();
    const counterpartyId = `${SYNTHETIC_COUNTERPARTY_PREFIX}-${crypto.randomBytes(4).toString('hex')}`;
    const execution = order.recordFill(baseRemaining, price, counterpartyId, timestamp);
    if (!execution) {
      return null;
    }

    const quoteAmount = Number.isFinite(price) ? baseRemaining * price : null;
    const trade = {
      price,
      amount: baseRemaining,
      fillAmount: baseRemaining,
      buyOrderId: order.isBuy() ? order.id : counterpartyId,
      sellOrderId: order.isSell() ? order.id : counterpartyId,
      makerOrderId: counterpartyId,
      takerOrderId: order.id,
      timestamp,
      synthetic: true,
      syntheticCounterparty: counterpartyId,
      syntheticQuoteAmount: quoteAmount,
    };

    order.metadata = order.metadata || {};
    order.metadata.syntheticFill = {
      counterparty: counterpartyId,
      price,
      quoteAmount,
      liquiditySource: 'synthetic',
      filledAt: timestamp,
    };

    this._recordTrade(pairKey, trade);
    this._updateMarketPriceInternal(pairKey, price, { source: 'synthetic', skipStopTrigger: true });
    this._applyMarketBuyImpact(order, pairKey, price, baseRemaining);
    priceOracleService.registerTrade(order.baseToken, order.quoteToken, {
      price,
      baseAmount: baseRemaining,
      quoteAmount: quoteAmount !== null ? quoteAmount : baseRemaining * price,
      side: order.isSell() ? 'SELL' : 'BUY',
      source: 'synthetic',
    });
    return trade;
  }

  _handleMarketOrder(order, book, pairKey) {
    const restingMarketOpposite = order.isBuy() ? book.marketSell : book.marketBuy;
    const trades = [];

    if (restingMarketOpposite.length > 0) {
      trades.push(...this._matchOrder(pairKey, order, restingMarketOpposite, () => true));
    }

    const opposite = order.isBuy() ? book.sell : book.buy;

    const requiresFullFill = order.timeInForce === TIME_IN_FORCE.FOK || order.allowPartialFill === false;
    if (requiresFullFill) {
      const fillableFromResting = this._calculateFillableVolume(restingMarketOpposite, () => true);
      const fillableFromOpposite = this._calculateFillableVolume(opposite, () => true);
      const totalFillable = fillableFromResting + fillableFromOpposite;
      if (totalFillable < order.remaining && !this._shouldUseSyntheticLiquidity(order)) {
        order.metadata = order.metadata || {};
        order.metadata.rejectReason = 'INSUFFICIENT_LIQUIDITY';
        order.metadata.availableVolume = totalFillable;
        order.status = 'REJECTED';
        return [];
      }
    }

    if (order.remaining > 0) {
      trades.push(...this._matchOrder(pairKey, order, opposite, () => true));
    }

    if (order.remaining > 0 && this._shouldUseSyntheticLiquidity(order)) {
      const syntheticTrade = this._fillWithSyntheticLiquidity(order, pairKey);
      if (syntheticTrade) {
        trades.push(syntheticTrade);
      }
    }

    if (order.remaining > 0) {
      order.metadata = order.metadata || {};
      order.metadata.unfilledAmount = order.remaining;
      if (order.timeInForce === TIME_IN_FORCE.IOC) {
        order.metadata.cancelReason = 'IOC_UNFILLED';
        order.status = order.filled > 0 ? 'PARTIAL' : 'REJECTED';
      } else if (order.timeInForce === TIME_IN_FORCE.FOK || order.allowPartialFill === false) {
        order.status = order.filled > 0 ? 'PARTIAL' : 'REJECTED';
      } else {
        this._restMarketOrder(order, book);
      }
    } else {
      order.status = 'FILLED';
    }

    return trades;
  }

  _queueStopOrder(order, book, listName, pairKey) {
    if (order.stopPrice === null || Number.isNaN(Number(order.stopPrice))) {
      order.metadata = order.metadata || {};
      order.metadata.rejectReason = 'INVALID_STOP_PRICE';
      order.status = 'REJECTED';
      return [];
    }

    order.status = 'PENDING';
    order.metadata = order.metadata || {};
    order.metadata.queuedAt = new Date();
    book[listName].push(order);

    if (pairKey) {
      let snapshot = this.getMarketPriceSnapshotFromKey(pairKey);
      let currentPrice = Number(snapshot?.price);
      let previousPrice = Number(snapshot?.previousPrice);

      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        const oracleSnapshot = priceOracleService.getCachedPairSnapshot(order.baseToken, order.quoteToken);
        if (oracleSnapshot && Number.isFinite(oracleSnapshot.price) && oracleSnapshot.price > 0) {
          const metadata = { source: oracleSnapshot.source || 'synthetic' };
          if (oracleSnapshot.updatedAt instanceof Date && !Number.isNaN(oracleSnapshot.updatedAt.getTime())) {
            metadata.updatedAt = oracleSnapshot.updatedAt;
          }
          this._updateMarketPriceInternal(pairKey, oracleSnapshot.price, metadata);
          snapshot = this.getMarketPriceSnapshotFromKey(pairKey);
          currentPrice = Number(snapshot?.price);
          previousPrice = Number(snapshot?.previousPrice);
        }
      }

      if (!Number.isFinite(previousPrice) || previousPrice <= 0) {
        previousPrice = null;
      }

      if (
        Number.isFinite(currentPrice)
        && currentPrice > 0
        && this._shouldTriggerStop(
          order,
          currentPrice,
          Number.isFinite(previousPrice) && previousPrice > 0 ? previousPrice : null,
        )
      ) {
        this._removeOrderFromList(book[listName], order.id);
        const triggerContext = this._buildTriggerContext(snapshot, currentPrice, previousPrice);
        const stopType = listName === 'stopLoss' ? ORDER_TYPES.STOP_LOSS : ORDER_TYPES.STOP_LIMIT;
        const tradesMap = this._processTriggeredStops(
          [{ order, type: stopType }],
          book,
          pairKey,
          triggerContext,
        );
        return tradesMap.get(order.id) || [];
      }
    }

    return [];
  }

  _matchOrder(pairKey, taker, oppositeList, canMatch) {
    const trades = [];

    while (taker.remaining > 0 && oppositeList.length > 0) {
      const maker = oppositeList[0];
      if (!canMatch(maker)) {
        break;
      }

      const fillAmount = Math.min(taker.remaining, maker.remaining);
      if (fillAmount <= 0) {
        break;
      }

      const tradePrice = this._determineTradePrice(taker, maker, pairKey);
      const timestamp = new Date();

      maker.metadata = maker.metadata || {};
      taker.metadata = taker.metadata || {};

      maker.recordFill(fillAmount, tradePrice, taker.id, timestamp);
      taker.recordFill(fillAmount, tradePrice, maker.id, timestamp);

      maker.metadata.lastTradePrice = tradePrice;
      maker.metadata.lastTradeAt = timestamp;
      taker.metadata.lastTradePrice = tradePrice;
      taker.metadata.lastTradeAt = timestamp;

      const trade = {
        price: tradePrice,
        amount: fillAmount,
        fillAmount,
        buyOrderId: taker.isBuy() ? taker.id : maker.id,
        sellOrderId: taker.isSell() ? taker.id : maker.id,
        makerOrderId: maker.id,
        takerOrderId: taker.id,
        timestamp,
      };
      trades.push(trade);

      this._recordTrade(pairKey, trade);
      this._updateMarketPriceInternal(pairKey, tradePrice, { source: 'orderbook' });
      this._applyMarketBuyImpact(taker, pairKey, tradePrice, fillAmount);
      this._applyMarketBuyImpact(maker, pairKey, tradePrice, fillAmount);
      priceOracleService.registerTrade(taker.baseToken, taker.quoteToken, {
        price: tradePrice,
        baseAmount: fillAmount,
        quoteAmount: fillAmount * tradePrice,
        side: taker.isSell() ? 'SELL' : 'BUY',
        source: 'orderbook',
      });

      if (maker.remaining <= 0) {
        oppositeList.shift();
      }
    }

    return trades;
  }

  _calculateFillableVolume(oppositeList, canMatch) {
    let total = 0;
    for (const order of oppositeList) {
      if (!canMatch(order)) {
        break;
      }
      total += order.remaining;
    }
    return total;
  }

  _restOnBook(order, list, side) {
    if (!list.includes(order)) {
      list.push(order);
    }
    if (order.filled === 0) {
      order.status = 'PENDING';
    }
    this._sortOrders(list, side);
  }

  _restMarketOrder(order, book) {
    const list = order.isBuy() ? book.marketBuy : book.marketSell;
    if (!list.includes(order)) {
      list.push(order);
    }
    order.status = order.filled > 0 ? 'PARTIAL' : 'PENDING';
    order.metadata = order.metadata || {};
    order.metadata.restedAt = order.metadata.restedAt || new Date();
  }

  _sortOrders(list, side) {
    list.sort((a, b) => {
      const priceA = a.price ?? 0;
      const priceB = b.price ?? 0;
      if (side === 'BUY') {
        if (priceB !== priceA) {
          return priceB - priceA;
        }
      } else if (side === 'SELL') {
        if (priceA !== priceB) {
          return priceA - priceB;
        }
      }
      const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return timeA - timeB;
    });
  }

  _getPairKey(baseToken, quoteToken) {
    return `${String(baseToken).toLowerCase()}-${String(quoteToken).toLowerCase()}`;
  }

  _getOrCreateOrderBook(pairKey) {
    if (!this.orderBooks.has(pairKey)) {
      this.orderBooks.set(pairKey, this._emptyBook());
    }
    const book = this.orderBooks.get(pairKey);
    if (!book.marketBuy) {
      book.marketBuy = [];
    }
    if (!book.marketSell) {
      book.marketSell = [];
    }
    return book;
  }

  _emptyBook() {
    return {
      buy: [],
      sell: [],
      marketBuy: [],
      marketSell: [],
      stopLoss: [],
      stopLimit: [],
      trades: [],
    };
  }

  _cloneBook(book) {
    return {
      buy: [...book.buy],
      sell: [...book.sell],
      marketBuy: [...book.marketBuy],
      marketSell: [...book.marketSell],
      stopLoss: [...book.stopLoss],
      stopLimit: [...book.stopLimit],
      trades: [...book.trades],
    };
  }

  _removeOrderFromList(list, orderId) {
    if (!Array.isArray(list) || !orderId) {
      return false;
    }
    const index = list.findIndex((order) => order && order.id === orderId);
    if (index === -1) {
      return false;
    }
    list.splice(index, 1);
    return true;
  }

  _determineTradePrice(taker, maker, pairKey) {
    if (maker.price !== null && maker.price !== undefined) {
      return maker.price;
    }
    if (taker.price !== null && taker.price !== undefined) {
      return taker.price;
    }
    const snapshot = this.getMarketPriceSnapshotFromKey(pairKey);
    if (snapshot) {
      return snapshot.price;
    }
    return 0;
  }

  _recordTrade(pairKey, trade) {
    const book = this._getOrCreateOrderBook(pairKey);
    book.trades.push(trade);
    if (book.trades.length > this.maxTradeHistory) {
      book.trades.shift();
    }
  }

  _normalizeMarketMetadata(metadata = {}) {
    const normalized = {};
    if (metadata && typeof metadata.source === 'string' && metadata.source.trim().length > 0) {
      normalized.source = metadata.source;
    }
    if (metadata && metadata.updatedAt instanceof Date && !Number.isNaN(metadata.updatedAt.getTime())) {
      normalized.updatedAt = metadata.updatedAt;
    }
    if (metadata && Number.isFinite(Number(metadata.previousPrice)) && Number(metadata.previousPrice) > 0) {
      normalized.previousPrice = Number(metadata.previousPrice);
    }
    return normalized;
  }

  _setMarketPriceEntry(pairKey, price, metadata = {}) {
    this.marketPrices.set(pairKey, price);
    const previousMeta = this.marketPriceMeta.get(pairKey) || {};
    const source = metadata.source || previousMeta.source || 'unknown';
    let updatedAt = metadata.updatedAt;
    if (!(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime())) {
      updatedAt = new Date();
    }
    const previousPrice = Number.isFinite(metadata.previousPrice)
      ? Number(metadata.previousPrice)
      : (Number.isFinite(previousMeta.price) ? Number(previousMeta.price) : null);
    this.marketPriceMeta.set(pairKey, {
      source,
      updatedAt,
      previousPrice,
      price,
    });
  }

  _applyMarketBuyImpact(order, pairKey, referencePrice, baseFilled) {
    if (!order || typeof order.isBuy !== 'function' || typeof order.orderType !== 'string') {
      return;
    }

    if (!order.isBuy() || order.orderType.toUpperCase() !== ORDER_TYPES.MARKET) {
      return;
    }

    const filledAmount = Number(baseFilled);
    if (!Number.isFinite(filledAmount) || filledAmount <= 0) {
      return;
    }

    const impact = filledAmount * MARKET_BUY_PRICE_IMPACT_RATE;
    if (!Number.isFinite(impact) || impact <= 0) {
      return;
    }

    const tradeReference = Number(referencePrice);
    let baselinePrice = Number.isFinite(tradeReference) && tradeReference > 0
      ? tradeReference
      : null;

    if (!Number.isFinite(baselinePrice) || baselinePrice <= 0) {
      const snapshot = this.getMarketPriceSnapshotFromKey(pairKey);
      if (snapshot && Number.isFinite(snapshot.price) && snapshot.price > 0) {
        baselinePrice = snapshot.price;
      }
    }

    if (!Number.isFinite(baselinePrice) || baselinePrice <= 0) {
      return;
    }

    const boostedPrice = baselinePrice + impact;
    if (!Number.isFinite(boostedPrice) || boostedPrice <= baselinePrice) {
      return;
    }

    this._updateMarketPriceInternal(pairKey, boostedPrice, {
      source: 'market-buy-impact',
      previousPrice: baselinePrice,
    });

    priceOracleService.registerTrade(order.baseToken, order.quoteToken, {
      price: boostedPrice,
      baseAmount: filledAmount,
      quoteAmount: filledAmount * boostedPrice,
      side: 'BUY',
      source: 'market-buy-impact',
    });
  }

  _updateMarketPriceInternal(pairKey, price, metadata = {}) {
    const numericPrice = Number(price);
    if (Number.isNaN(numericPrice) || numericPrice <= 0) {
      return;
    }

    const { skipStopTrigger = false, ...restMetadata } = metadata || {};

    const previousPrice = this.marketPrices.has(pairKey) ? this.marketPrices.get(pairKey) : null;

    const normalizedMetadata = this._normalizeMarketMetadata({
      ...restMetadata,
      previousPrice,
    });
    this._setMarketPriceEntry(pairKey, numericPrice, normalizedMetadata);

    let inverseKey = null;
    let inversePrice = null;
    let previousInverse = null;
    if (typeof pairKey === 'string' && pairKey.includes('-')) {
      const [baseToken, quoteToken] = pairKey.split('-');
      if (baseToken && quoteToken) {
        inverseKey = this._getPairKey(quoteToken, baseToken);
        if (inverseKey !== pairKey) {
          previousInverse = this.marketPrices.has(inverseKey) ? this.marketPrices.get(inverseKey) : null;
          const computedInverse = numericPrice > 0 ? 1 / numericPrice : null;
          if (Number.isFinite(computedInverse) && computedInverse > 0) {
            inversePrice = computedInverse;
            const inverseMetadata = this._normalizeMarketMetadata({
              ...restMetadata,
              previousPrice: previousInverse,
            });
            this._setMarketPriceEntry(inverseKey, inversePrice, inverseMetadata);
          }
        }
      }
    }

    if (!skipStopTrigger && inverseKey && inversePrice) {
      this._triggerStopOrders(inverseKey, inversePrice, previousInverse);
    }

    if (!skipStopTrigger) {
      this._triggerStopOrders(pairKey, numericPrice, previousPrice);
    }
  }

  _triggerStopOrders(pairKey, price, previousPrice = null) {
    const book = this.orderBooks.get(pairKey);
    if (!book) {
      return;
    }

    const triggered = [];
    const snapshot = this.getMarketPriceSnapshotFromKey(pairKey);
    const triggerContext = this._buildTriggerContext(snapshot, price, previousPrice);

    book.stopLoss = book.stopLoss.filter((order) => {
      if (this._shouldTriggerStop(order, price, previousPrice)) {
        triggered.push({ order, type: ORDER_TYPES.STOP_LOSS });
        return false;
      }
      return true;
    });

    book.stopLimit = book.stopLimit.filter((order) => {
      if (this._shouldTriggerStop(order, price, previousPrice)) {
        triggered.push({ order, type: ORDER_TYPES.STOP_LIMIT });
        return false;
      }
      return true;
    });

    if (triggered.length > 0) {
      this._processTriggeredStops(triggered, book, pairKey, triggerContext);
    }
  }

  _shouldTriggerStop(order, price, previousPrice = null) {
    if (order.stopPrice === null || order.stopPrice === undefined) {
      return false;
    }
    const stop = Number(order.stopPrice);
    const current = Number(price);
    if (!Number.isFinite(stop) || !Number.isFinite(current)) {
      return false;
    }
    if (order.isSell()) {
      if (current <= stop) {
        return true;
      }
      return false;
    }

    if (current >= stop) {
      return true;
    }
    return false;
  }

  _buildTriggerContext(snapshot, fallbackPrice, previousPrice = null) {
    const triggerPrice = Number.isFinite(snapshot?.price) && snapshot.price > 0
      ? snapshot.price
      : fallbackPrice;
    const triggerSource = snapshot?.source || 'trigger';
    const triggerTimestamp = snapshot?.updatedAt instanceof Date && !Number.isNaN(snapshot.updatedAt.getTime())
      ? snapshot.updatedAt
      : new Date();

    return {
      price: Number.isFinite(triggerPrice) && triggerPrice > 0 ? triggerPrice : null,
      source: triggerSource,
      timestamp: triggerTimestamp,
      previousPrice: Number.isFinite(previousPrice) && previousPrice > 0
        ? previousPrice
        : (Number.isFinite(snapshot?.previousPrice) && snapshot.previousPrice > 0 ? snapshot.previousPrice : null),
    };
  }

  _executeTriggeredStop(order, type, book, pairKey, context = {}) {
    const result = this._processTriggeredStops(
      [{ order, type }],
      book,
      pairKey,
      context,
    );
    return result.get(order.id) || [];
  }

  _processTriggeredStops(entries, book, pairKey, context = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return new Map();
    }

    const normalizedEntries = entries
      .map((entry) => (entry && entry.order ? entry : null))
      .filter(Boolean);

    if (normalizedEntries.length === 0) {
      return new Map();
    }

    const tradesByOrder = new Map();
    const normalizedContext = context || {};

    for (const entry of normalizedEntries) {
      this._prepareTriggeredStopMetadata(entry.order, normalizedContext);
      if (entry.type === ORDER_TYPES.STOP_LOSS) {
        entry.order.orderType = ORDER_TYPES.MARKET;
      } else {
        entry.order.orderType = ORDER_TYPES.LIMIT;
      }
    }

    const stopLimitEntries = normalizedEntries.filter((entry) => entry.type === ORDER_TYPES.STOP_LIMIT);
    const stopLossEntries = normalizedEntries.filter((entry) => entry.type === ORDER_TYPES.STOP_LOSS);

    if (stopLimitEntries.length > 0) {
      for (const entry of stopLimitEntries) {
        if (entry.order.remaining <= 0) {
          continue;
        }
        const trades = this._handleLimitOrder(entry.order, book, pairKey);
        if (trades.length > 0) {
          const existing = tradesByOrder.get(entry.order.id) || [];
          tradesByOrder.set(entry.order.id, [...existing, ...trades]);
        }
      }
    }

    if (stopLossEntries.length > 0) {
      const pairTrades = this._matchTriggeredStopLoss(stopLossEntries, pairKey, normalizedContext);
      for (const [orderId, orderTrades] of pairTrades.entries()) {
        const existing = tradesByOrder.get(orderId) || [];
        tradesByOrder.set(orderId, [...existing, ...orderTrades]);
      }

      for (const entry of stopLossEntries) {
        if (entry.order.remaining <= 0) {
          continue;
        }
        const trades = this._handleMarketOrder(entry.order, book, pairKey);
        if (trades.length > 0) {
          const existing = tradesByOrder.get(entry.order.id) || [];
          tradesByOrder.set(entry.order.id, [...existing, ...trades]);
        }
      }
    }

    for (const entry of normalizedEntries) {
      const trades = tradesByOrder.get(entry.order.id);
      if (trades && trades.length > 0) {
        entry.order.metadata = entry.order.metadata || {};
        const existing = Array.isArray(entry.order.metadata.trades)
          ? entry.order.metadata.trades
          : [];
        entry.order.metadata.trades = [...existing, ...trades];
      }
    }

    return tradesByOrder;
  }

  _prepareTriggeredStopMetadata(order, context = {}) {
    const triggerPrice = Number.isFinite(context.price) && context.price > 0 ? context.price : null;
    const triggerSource = context.source || 'trigger';
    const triggerTimestamp = context.timestamp instanceof Date && !Number.isNaN(context.timestamp.getTime())
      ? context.timestamp
      : new Date();

    order.metadata = order.metadata || {};
    if (triggerPrice !== null) {
      order.metadata.triggeredPrice = triggerPrice;
      if (!Number.isFinite(Number(order.metadata.price)) || Number(order.metadata.price) <= 0) {
        order.metadata.price = triggerPrice;
      }
    }
    order.metadata.triggerSource = triggerSource;
    order.metadata.triggeredAt = triggerTimestamp;
    if (!order.metadata.priceSource && triggerSource) {
      order.metadata.priceSource = triggerSource;
    }

    order.markTriggered(triggerTimestamp);
  }

  _matchTriggeredStopLoss(entries, pairKey, context = {}) {
    const tradesByOrder = new Map();
    if (!Array.isArray(entries) || entries.length === 0) {
      return tradesByOrder;
    }

    const buyQueue = entries.filter((entry) => entry.order.isBuy());
    const sellQueue = entries.filter((entry) => entry.order.isSell());

    while (buyQueue.length > 0 && sellQueue.length > 0) {
      const buyEntry = buyQueue[0];
      const sellEntry = sellQueue[0];

      const fillAmount = this._determineTriggeredStopFillAmount(buyEntry.order, sellEntry.order);
      if (!(fillAmount > 0)) {
        if (buyEntry.order.remaining > sellEntry.order.remaining) {
          sellQueue.shift();
        } else if (sellEntry.order.remaining > buyEntry.order.remaining) {
          buyQueue.shift();
        } else {
          const buyMin = Number.isFinite(buyEntry.order.minFillAmount) ? buyEntry.order.minFillAmount : 0;
          const sellMin = Number.isFinite(sellEntry.order.minFillAmount) ? sellEntry.order.minFillAmount : 0;
          if (buyMin >= sellMin) {
            buyQueue.shift();
          } else {
            sellQueue.shift();
          }
        }
        continue;
      }

      const tradePrice = this._resolveTriggeredTradePrice(
        buyEntry.order,
        sellEntry.order,
        pairKey,
        context,
      );
      if (!Number.isFinite(tradePrice) || tradePrice <= 0) {
        break;
      }

      const timestamp = new Date();
      buyEntry.order.metadata = buyEntry.order.metadata || {};
      sellEntry.order.metadata = sellEntry.order.metadata || {};

      buyEntry.order.recordFill(fillAmount, tradePrice, sellEntry.order.id, timestamp);
      sellEntry.order.recordFill(fillAmount, tradePrice, buyEntry.order.id, timestamp);

      buyEntry.order.metadata.lastTradePrice = tradePrice;
      buyEntry.order.metadata.lastTradeAt = timestamp;
      sellEntry.order.metadata.lastTradePrice = tradePrice;
      sellEntry.order.metadata.lastTradeAt = timestamp;

      const makerOrder = this._determineTriggeredStopMaker(buyEntry.order, sellEntry.order);
      const takerOrder = makerOrder.id === buyEntry.order.id ? sellEntry.order : buyEntry.order;

      const tradeRecord = {
        price: tradePrice,
        amount: fillAmount,
        fillAmount,
        buyOrderId: buyEntry.order.id,
        sellOrderId: sellEntry.order.id,
        makerOrderId: makerOrder.id,
        takerOrderId: takerOrder.id,
        timestamp,
      };

      this._recordTrade(pairKey, tradeRecord);
      this._updateMarketPriceInternal(pairKey, tradePrice, { source: 'stop-trigger', skipStopTrigger: true });
      priceOracleService.registerTrade(buyEntry.order.baseToken, buyEntry.order.quoteToken, {
        price: tradePrice,
        baseAmount: fillAmount,
        quoteAmount: fillAmount * tradePrice,
        side: takerOrder.isSell() ? 'SELL' : 'BUY',
        source: 'stop-trigger',
      });

      const buyTrades = tradesByOrder.get(buyEntry.order.id) || [];
      buyTrades.push(tradeRecord);
      tradesByOrder.set(buyEntry.order.id, buyTrades);

      const sellTrades = tradesByOrder.get(sellEntry.order.id) || [];
      sellTrades.push(tradeRecord);
      tradesByOrder.set(sellEntry.order.id, sellTrades);

      if (buyEntry.order.remaining <= 0) {
        buyQueue.shift();
      }
      if (sellEntry.order.remaining <= 0) {
        sellQueue.shift();
      }
    }

    return tradesByOrder;
  }

  _resolveTriggeredTradePrice(buyOrder, sellOrder, pairKey, context = {}) {
    const contextPrice = Number.isFinite(context.price) && context.price > 0 ? context.price : null;
    if (contextPrice !== null) {
      return contextPrice;
    }

    const buyStop = Number.isFinite(buyOrder.stopPrice) && buyOrder.stopPrice > 0 ? buyOrder.stopPrice : null;
    const sellStop = Number.isFinite(sellOrder.stopPrice) && sellOrder.stopPrice > 0 ? sellOrder.stopPrice : null;

    if (buyStop !== null && sellStop !== null) {
      return (buyStop + sellStop) / 2;
    }
    if (buyStop !== null) {
      return buyStop;
    }
    if (sellStop !== null) {
      return sellStop;
    }

    const snapshot = this.getMarketPriceSnapshotFromKey(pairKey);
    if (snapshot && Number.isFinite(snapshot.price) && snapshot.price > 0) {
      return snapshot.price;
    }

    return null;
  }

  _determineTriggeredStopFillAmount(buyOrder, sellOrder) {
    const maxFill = Math.min(buyOrder.remaining, sellOrder.remaining);
    if (!(maxFill > 0)) {
      return 0;
    }

    if (this._requiresFullFill(buyOrder) && sellOrder.remaining < buyOrder.remaining) {
      return 0;
    }
    if (this._requiresFullFill(sellOrder) && buyOrder.remaining < sellOrder.remaining) {
      return 0;
    }

    if (Number.isFinite(buyOrder.minFillAmount) && buyOrder.minFillAmount > maxFill) {
      return 0;
    }
    if (Number.isFinite(sellOrder.minFillAmount) && sellOrder.minFillAmount > maxFill) {
      return 0;
    }

    if (this._requiresFullFill(buyOrder)) {
      return buyOrder.remaining;
    }
    if (this._requiresFullFill(sellOrder)) {
      return sellOrder.remaining;
    }

    return maxFill;
  }

  _requiresFullFill(order) {
    if (!order) {
      return false;
    }
    if (order.timeInForce === TIME_IN_FORCE.FOK) {
      return true;
    }
    if (order.allowPartialFill === false) {
      return true;
    }
    return false;
  }

  _determineTriggeredStopMaker(buyOrder, sellOrder) {
    const buyTime = buyOrder.createdAt instanceof Date
      ? buyOrder.createdAt.getTime()
      : new Date(buyOrder.createdAt).getTime();
    const sellTime = sellOrder.createdAt instanceof Date
      ? sellOrder.createdAt.getTime()
      : new Date(sellOrder.createdAt).getTime();

    if (Number.isFinite(buyTime) && Number.isFinite(sellTime)) {
      if (buyTime <= sellTime) {
        return buyOrder;
      }
      return sellOrder;
    }
    if (Number.isFinite(buyTime)) {
      return buyOrder;
    }
    if (Number.isFinite(sellTime)) {
      return sellOrder;
    }
    return sellOrder;
  }

  _cleanupOrderFromBooks(order) {
    if (!order || !order.baseToken || !order.quoteToken) {
      return;
    }
    const pairKey = this._getPairKey(order.baseToken, order.quoteToken);
    const book = this.orderBooks.get(pairKey);
    if (!book) {
      return;
    }
    if (order.isBuy()) {
      this._removeOrderFromList(book.buy, order.id);
      this._removeOrderFromList(book.marketBuy, order.id);
    } else {
      this._removeOrderFromList(book.sell, order.id);
      this._removeOrderFromList(book.marketSell, order.id);
    }
    this._removeOrderFromList(book.stopLoss, order.id);
    this._removeOrderFromList(book.stopLimit, order.id);
  }

  _generateBatchId() {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
  }

  _normalizeBatchOrder(order, index) {
    if (!order || typeof order !== 'object') {
      throw new Error(`Invalid order at batch index ${index}`);
    }
    if (typeof order.isBuy !== 'function' || typeof order.isSell !== 'function') {
      throw new Error('Batch execution requires order instances');
    }
    if (order.remaining <= 0) {
      throw new Error(`Order ${order.id || index} has no remaining amount`);
    }
    if (['CANCELLED', 'FILLED', 'REJECTED', 'EXPIRED'].includes(order.status)) {
      throw new Error(`Order ${order.id || index} is not active`);
    }
    const price = Number(order.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Order ${order.id || index} must specify a valid price for batch execution`);
    }

    const offerToken = order.isSell() ? order.baseToken : order.quoteToken;
    const requestToken = order.isSell() ? order.quoteToken : order.baseToken;
    if (!offerToken || !requestToken) {
      throw new Error(`Order ${order.id || index} is missing token information`);
    }

    const offerRemaining = order.isSell() ? order.remaining : order.remaining * price;
    const rate = order.isSell() ? price : 1 / price;
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Order ${order.id || index} has an invalid conversion rate`);
    }

    return {
      order,
      price,
      rate,
      offerToken: String(offerToken).toLowerCase(),
      requestToken: String(requestToken).toLowerCase(),
      offerTokenRaw: String(offerToken),
      requestTokenRaw: String(requestToken),
      offerRemaining,
      isSell: order.isSell(),
      allowPartialFill: order.allowPartialFill,
    };
  }
}

module.exports = new MatchingService();
