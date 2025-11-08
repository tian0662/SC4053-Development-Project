const express = require('express');
const priceOracleService = require('../../services/price-oracle.service');
const tokenService = require('../../services/token.service');
const orderService = require('../../services/order.service');

const router = express.Router();

function buildTokenSummary(meta) {
  if (!meta || typeof meta !== 'object') {
    return {};
  }
  return {
    address: meta.address || null,
    symbol: meta.symbol || null,
    name: meta.name || null,
    decimals: Number.isInteger(meta.decimals) ? Number(meta.decimals) : null,
    totalSupply: meta.totalSupply ?? null,
    issuer: meta.issuer || null,
  };
}

router.get('/pair', async (req, res) => {
  const { baseToken, quoteToken } = req.query;
  if (!baseToken || !quoteToken) {
    return res.status(400).json({ message: 'baseToken and quoteToken are required' });
  }

  try {
    const description = await priceOracleService.describePair(baseToken, quoteToken);
    if (!description) {
      return res.status(404).json({ message: 'Unable to derive price for requested pair' });
    }

    if (Number.isFinite(description.priceNumber) && description.priceNumber > 0) {
      orderService.updateMarketPrice(description.baseToken, description.quoteToken, description.priceNumber);
    }

    return res.json({
      baseToken: description.baseToken,
      quoteToken: description.quoteToken,
      price: description.price,
      priceNumber: description.priceNumber,
      inversePrice: description.inversePrice,
      inversePriceNumber: description.inversePriceNumber,
      base: buildTokenSummary({ ...description.base, address: description.baseToken }),
      quote: buildTokenSummary({ ...description.quote, address: description.quoteToken }),
      baseUnitValue: description.baseUnitValue,
      quoteUnitValue: description.quoteUnitValue,
      source: description.source,
      calculatedAt: description.calculatedAt,
      dynamic: description.dynamic || null,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to derive price' });
  }
});

router.get('/matrix', async (req, res) => {
  const { tokens } = req.query;
  let addresses = [];
  if (typeof tokens === 'string' && tokens.trim().length > 0) {
    addresses = tokens
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (addresses.length === 0) {
    addresses = tokenService.listTokens().map((token) => token.address);
  }

  try {
    const matrix = await priceOracleService.describeMatrix(addresses);

    if (matrix?.pairs?.length) {
      matrix.pairs.forEach((entry) => {
        if (
          entry
          && entry.baseToken
          && entry.quoteToken
          && entry.baseToken !== entry.quoteToken
          && Number.isFinite(entry.priceNumber)
          && entry.priceNumber > 0
        ) {
          orderService.updateMarketPrice(entry.baseToken, entry.quoteToken, entry.priceNumber);
        }
      });
    }

    return res.json(matrix);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to build price matrix' });
  }
});

module.exports = router;
