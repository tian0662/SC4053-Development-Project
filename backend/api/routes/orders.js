const express = require('express');
const orderService = require('../../services/order.service');

const router = express.Router();

router.get('/', (req, res) => {
  const { baseToken, quoteToken, trader, status } = req.query;
  const orders = orderService
    .listOrders({ baseToken, quoteToken, trader, status })
    .map((order) => orderService.toJSON(order));
  res.json(orders);
});

router.get('/book', (req, res) => {
  const { baseToken, quoteToken } = req.query;
  const book = orderService.getOrderBook(baseToken, quoteToken);
  res.json(book);
});

router.get('/trades', (req, res) => {
  const { baseToken, quoteToken, limit } = req.query;
  if (!baseToken || !quoteToken) {
    return res.status(400).json({ message: 'baseToken and quoteToken are required' });
  }
  const numericLimit = limit ? Number(limit) : undefined;
  const trades = orderService.getRecentTrades(baseToken, quoteToken, numericLimit);
  return res.json(trades);
});

router.post('/', async (req, res) => {
  try {
    const order = await orderService.createOrder(req.body);
    res.status(201).json(orderService.toJSON(order));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/prepare', async (req, res) => {
  try {
    const prepared = await orderService.prepareOrder(req.body || {});
    res.json(prepared);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post('/batch', async (req, res) => {
  const { orderIds, tolerance } = req.body || {};
  if (!Array.isArray(orderIds) || orderIds.length < 2) {
    return res.status(400).json({ message: 'orderIds array with at least two ids is required' });
  }
  try {
    const batchResult = await orderService.executeBatch(orderIds, { tolerance });
    return res.json(batchResult);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/market-price', (req, res) => {
  const { baseToken, quoteToken, price } = req.body || {};
  if (!baseToken || !quoteToken || price === undefined || price === null) {
    return res
      .status(400)
      .json({ message: 'baseToken, quoteToken and price are required' });
  }
  try {
    const updatedPrice = orderService.updateMarketPrice(baseToken, quoteToken, price);
    return res.json({ baseToken, quoteToken, price: updatedPrice });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.get('/:id', (req, res) => {
  const order = orderService.getOrder(req.params.id);
  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }
  return res.json(orderService.toJSON(order));
});

router.post('/:id/cancel', (req, res) => {
  const order = orderService.cancelOrder(req.params.id, req.body?.reason);
  if (!order) {
    return res.status(404).json({ message: 'Order not found' });
  }
  return res.json(orderService.toJSON(order));
});

module.exports = router;
