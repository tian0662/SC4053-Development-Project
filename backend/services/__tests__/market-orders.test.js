const { describe, beforeEach, it } = require('node:test');
const assert = require('assert/strict');

const matchingService = require('../matching.service');
const Order = require('../../models/Order');

const BASE_TOKEN = 'AAA';
const QUOTE_TOKEN = 'BBB';
const PAIR_KEY = `${BASE_TOKEN.toLowerCase()}-${QUOTE_TOKEN.toLowerCase()}`;

describe('Market order resting and matching', () => {
  beforeEach(() => {
    matchingService.orderBooks.clear();
    matchingService.marketPrices.clear();
    matchingService.marketPriceMeta.clear();
  });

  it('rests an unmatched market order until an opposite limit order arrives', () => {
    const buyMarket = new Order({
      id: 'buy-market-rest',
      trader: '0x0000000000000000000000000000000000000001',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'BUY',
      amount: 5,
      orderType: 'MARKET',
    });

    matchingService.addOrder(buyMarket);

    assert.strictEqual(buyMarket.status, 'PENDING');
    assert.strictEqual(buyMarket.remaining, 5);

    const initialBook = matchingService.orderBooks.get(PAIR_KEY);
    assert.ok(initialBook);
    assert.strictEqual(initialBook.marketBuy.length, 1);

    const sellLimit = new Order({
      id: 'sell-limit-fill',
      trader: '0x0000000000000000000000000000000000000002',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'SELL',
      amount: 5,
      orderType: 'LIMIT',
      price: 100,
    });

    matchingService.addOrder(sellLimit);

    assert.strictEqual(buyMarket.status, 'FILLED');
    assert.strictEqual(sellLimit.status, 'FILLED');

    const finalBook = matchingService.orderBooks.get(PAIR_KEY);
    assert.ok(finalBook);
    assert.strictEqual(finalBook.marketBuy.length, 0);
    assert.strictEqual(finalBook.sell.length, 0);
  });

  it('matches resting market orders against new market orders', () => {
    matchingService.updateMarketPrice(BASE_TOKEN, QUOTE_TOKEN, 42);

    const sellMarket = new Order({
      id: 'sell-market-rest',
      trader: '0x0000000000000000000000000000000000000003',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'SELL',
      amount: 3,
      orderType: 'MARKET',
    });

    matchingService.addOrder(sellMarket);

    assert.strictEqual(sellMarket.status, 'PENDING');
    assert.strictEqual(sellMarket.remaining, 3);

    const buyMarket = new Order({
      id: 'buy-market-match',
      trader: '0x0000000000000000000000000000000000000004',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'BUY',
      amount: 3,
      orderType: 'MARKET',
    });

    matchingService.addOrder(buyMarket);

    assert.strictEqual(sellMarket.status, 'FILLED');
    assert.strictEqual(buyMarket.status, 'FILLED');

    const book = matchingService.orderBooks.get(PAIR_KEY);
    assert.ok(book);
    assert.strictEqual(book.marketSell.length, 0);
    assert.strictEqual(book.marketBuy.length, 0);

    const trades = matchingService.getRecentTrades(BASE_TOKEN, QUOTE_TOKEN);
    assert.ok(trades.length >= 1, 'expected at least one trade to be recorded');
    assert.ok(trades.at(-1).price > 0, 'trade price should be derived from market snapshot');
  });

  it('boosts market price after buy market orders proportionally to filled amount', () => {
    matchingService.updateMarketPrice(BASE_TOKEN, QUOTE_TOKEN, 100);

    const sellLimit = new Order({
      id: 'sell-limit-liquidity',
      trader: '0x0000000000000000000000000000000000000005',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'SELL',
      amount: 4,
      orderType: 'LIMIT',
      price: 100,
    });

    matchingService.addOrder(sellLimit);

    const buyMarket = new Order({
      id: 'buy-market-impact',
      trader: '0x0000000000000000000000000000000000000006',
      baseToken: BASE_TOKEN,
      quoteToken: QUOTE_TOKEN,
      side: 'BUY',
      amount: 2,
      orderType: 'MARKET',
    });

    matchingService.addOrder(buyMarket);

    const snapshot = matchingService.getMarketPriceSnapshot(BASE_TOKEN, QUOTE_TOKEN);
    assert.ok(snapshot);
    assert.strictEqual(snapshot.previousPrice, 100);
    assert.strictEqual(snapshot.price, 102);
  });
});
