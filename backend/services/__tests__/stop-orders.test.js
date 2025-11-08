const { describe, beforeEach, it } = require('node:test');
const assert = require('assert/strict');

const matchingService = require('../matching.service');
const Order = require('../../models/Order');

const BASE_TOKEN = 'TYD';
const QUOTE_TOKEN = 'USTD';
const PAIR_KEY = `${BASE_TOKEN.toLowerCase()}-${QUOTE_TOKEN.toLowerCase()}`;

describe('Stop order triggering without prior price history', () => {
  beforeEach(() => {
    matchingService.orderBooks.clear();
    matchingService.marketPrices.clear();
    matchingService.marketPriceMeta.clear();
  });

  it('triggers a buy stop-loss when the current price already exceeds the stop', () => {
    matchingService.updateMarketPrice(BASE_TOKEN, QUOTE_TOKEN, 6.007);

    const buyStop = new Order({
      id: 'buy-stop',
      trader: '0x0000000000000000000000000000000000000001',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'BUY',
      amount: 1,
      orderType: 'STOP_LOSS',
      stopPrice: 6,
    });

    matchingService.addOrder(buyStop);

    assert.ok(buyStop.triggeredAt instanceof Date, 'expected buy stop to be triggered');
    assert.ok(buyStop.metadata?.triggeredPrice >= 6);

    const book = matchingService.orderBooks.get(PAIR_KEY);
    assert.ok(book);
    assert.strictEqual(book.stopLoss.length, 0, 'triggered stop should be removed from the stop list');
  });

  it('triggers a sell stop-loss when the current price is already below the stop', () => {
    matchingService.updateMarketPrice(BASE_TOKEN, QUOTE_TOKEN, 6.007);

    const sellStop = new Order({
      id: 'sell-stop',
      trader: '0x0000000000000000000000000000000000000002',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'SELL',
      amount: 1,
      orderType: 'STOP_LOSS',
      stopPrice: 7,
    });

    matchingService.addOrder(sellStop);

    assert.ok(sellStop.triggeredAt instanceof Date, 'expected sell stop to be triggered');
    assert.ok(sellStop.metadata?.triggeredPrice <= 7);

    const book = matchingService.orderBooks.get(PAIR_KEY);
    assert.ok(book);
    assert.strictEqual(book.stopLoss.length, 0, 'triggered stop should be removed from the stop list');
  });

  it('does not trigger the opposite stop when a synthetic fill occurs', () => {
    matchingService.updateMarketPrice(BASE_TOKEN, QUOTE_TOKEN, 5.65);

    const buyStop = new Order({
      id: 'buy-stop-pending',
      trader: '0x0000000000000000000000000000000000000003',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'BUY',
      amount: 1,
      orderType: 'STOP_LOSS',
      stopPrice: 6,
    });

    matchingService.addOrder(buyStop);

    assert.strictEqual(buyStop.triggeredAt, null, 'buy stop should remain queued while price is below trigger');

    const sellStop = new Order({
      id: 'sell-stop-triggered',
      trader: '0x0000000000000000000000000000000000000004',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'SELL',
      amount: 1,
      orderType: 'STOP_LOSS',
      stopPrice: 6,
    });

    matchingService.addOrder(sellStop);

    assert.ok(sellStop.triggeredAt instanceof Date, 'sell stop should trigger immediately');
    assert.strictEqual(buyStop.triggeredAt, null, 'synthetic fill must not trigger the opposite stop order');

    const book = matchingService.orderBooks.get(PAIR_KEY);
    assert.ok(book);
    const queuedIds = book.stopLoss.map((order) => order.id);
    assert.ok(queuedIds.includes(buyStop.id), 'buy stop should remain queued after opposite stop execution');
  });

  it('matches triggered buy and sell stop-loss orders against each other', () => {
    const buyStop = new Order({
      id: 'buy-stop-pair',
      trader: '0x0000000000000000000000000000000000000005',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'BUY',
      amount: 2,
      orderType: 'STOP_LOSS',
      stopPrice: 6,
    });

    const sellStop = new Order({
      id: 'sell-stop-pair',
      trader: '0x0000000000000000000000000000000000000006',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'SELL',
      amount: 2,
      orderType: 'STOP_LOSS',
      stopPrice: 6,
    });

    matchingService.addOrder(buyStop);
    matchingService.addOrder(sellStop);

    assert.strictEqual(buyStop.status, 'PENDING');
    assert.strictEqual(sellStop.status, 'PENDING');

    matchingService.updateMarketPrice(BASE_TOKEN, QUOTE_TOKEN, 6);

    assert.strictEqual(buyStop.status, 'FILLED', 'buy stop should fill once trigger conditions are met');
    assert.strictEqual(sellStop.status, 'FILLED', 'sell stop should fill once trigger conditions are met');
    assert.strictEqual(buyStop.filled, 2);
    assert.strictEqual(sellStop.filled, 2);
    assert.ok(Array.isArray(buyStop.metadata.trades) && buyStop.metadata.trades.length === 1);
    assert.ok(Array.isArray(sellStop.metadata.trades) && sellStop.metadata.trades.length === 1);

    const book = matchingService.orderBooks.get(PAIR_KEY);
    assert.ok(book);
    const lastTrade = book.trades[book.trades.length - 1];
    assert.ok(lastTrade);
    assert.strictEqual(lastTrade.buyOrderId, buyStop.id);
    assert.strictEqual(lastTrade.sellOrderId, sellStop.id);
  });
});
