const { ethers } = require('ethers');
const blockchainService = require('./blockchain.service');
const tokenService = require('./token.service');
const matchingService = require('./matching.service');
const priceOracleService = require('./price-oracle.service');
const {
  ORDER_TYPE_INDEX,
  TIME_IN_FORCE_INDEX,
  ORDER_SIDE_INDEX,
  getEIP712DomainType,
  buildOrderTypedData,
  hashOrder,
  serializeTypedDataValue,
} = require('../utils/signature');

const STOP_PRICE_SCALE = 18;

function toDecimalString(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Numeric value must be finite');
    }
    return value.toString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object' && typeof value.toString === 'function') {
    return value.toString();
  }
  return String(value);
}

function parseUnitsSafe(value, decimals, label) {
  const stringValue = toDecimalString(value);
  if (stringValue === null) {
    throw new Error(`${label} is required`);
  }
  try {
    return ethers.parseUnits(stringValue, decimals);
  } catch (error) {
    throw new Error(`${label} must be a numeric value: ${error.message}`);
  }
}

function tryParseUnits(value, decimals) {
  const stringValue = toDecimalString(value);
  if (stringValue === null) {
    return null;
  }
  try {
    return ethers.parseUnits(stringValue, decimals);
  } catch (error) {
    return null;
  }
}

function parseBigInt(value, label) {
  const stringValue = toDecimalString(value);
  if (stringValue === null) {
    return null;
  }
  try {
    if (stringValue.startsWith('0x') || stringValue.startsWith('0X')) {
      return BigInt(stringValue);
    }
    return BigInt(stringValue);
  } catch (error) {
    throw new Error(`${label} must be an integer value`);
  }
}

function resolveEnum(value, mapping, label, defaultKey) {
  if (value === undefined || value === null || value === '') {
    if (defaultKey && Object.prototype.hasOwnProperty.call(mapping, defaultKey)) {
      return { index: mapping[defaultKey], label: defaultKey };
    }
    throw new Error(`${label} is required`);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      if (defaultKey && Object.prototype.hasOwnProperty.call(mapping, defaultKey)) {
        return { index: mapping[defaultKey], label: defaultKey };
      }
      throw new Error(`${label} is required`);
    }
    const upper = trimmed.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(mapping, upper)) {
      return { index: mapping[upper], label: upper };
    }
    const numeric = Number(trimmed);
    if (Number.isInteger(numeric)) {
      for (const [key, index] of Object.entries(mapping)) {
        if (index === numeric) {
          return { index, label: key };
        }
      }
    }
  }

  if (typeof value === 'number') {
    const numeric = Math.trunc(value);
    for (const [key, index] of Object.entries(mapping)) {
      if (index === numeric) {
        return { index, label: key };
      }
    }
  }

  throw new Error(`${label} value ${value} is not supported`);
}

async function resolveNonce(trader, providedNonce) {
  const parsed = parseBigInt(providedNonce, 'nonce');
  if (parsed !== null) {
    return parsed;
  }

  const contract = blockchainService.getDexContract();
  const nonce = await contract.getNonce(trader);
  return BigInt(nonce.toString());
}

function resolveExpiry(value) {
  if (value === undefined || value === null || value === '') {
    return 0n;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('expiry must be a finite number');
    }
    return BigInt(Math.trunc(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return 0n;
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return BigInt(Math.trunc(numeric));
    }
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) {
      throw new Error('expiry must be a unix timestamp or ISO datetime string');
    }
    return BigInt(Math.floor(date.getTime() / 1000));
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('expiry date is invalid');
    }
    return BigInt(Math.floor(value.getTime() / 1000));
  }
  throw new Error('expiry value is not supported');
}

function formatUnits(value, decimals) {
  if (value === null || value === undefined) {
    return null;
  }
  return ethers.formatUnits(value, decimals);
}

function booleanFromInput(value, defaultValue = true) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return Boolean(value);
}

async function resolveChainId(inputChainId) {
  const parsed = inputChainId !== undefined && inputChainId !== null ? Number(inputChainId) : null;
  if (parsed && Number.isInteger(parsed)) {
    return parsed;
  }
  const chainId = await blockchainService.getChainId();
  if (!chainId) {
    throw new Error('Unable to determine chainId. Provide chainId or configure RPC connection.');
  }
  return chainId;
}

function buildOnchainStruct({
  maker,
  tokenGet,
  amountGet,
  tokenGive,
  amountGive,
  nonce,
  expiry,
  orderType,
  timeInForce,
  side,
  stopPrice,
  minFillAmount,
  allowPartialFill,
  feeRecipient,
  feeAmount,
}) {
  return {
    maker,
    tokenGet,
    amountGet: amountGet.toString(),
    tokenGive,
    amountGive: amountGive.toString(),
    nonce: nonce.toString(),
    expiry: expiry.toString(),
    orderType: orderType.index,
    timeInForce: timeInForce.index,
    side: side.index,
    stopPrice: stopPrice.toString(),
    minFillAmount: minFillAmount.toString(),
    allowPartialFill,
    feeRecipient,
    feeAmount: feeAmount.toString(),
  };
}

function buildMetadata({
  baseToken,
  quoteToken,
  baseDecimals,
  quoteDecimals,
  baseAmountUnits,
  quoteAmountUnits,
  price,
  priceSource,
  stopPriceValue,
  minFillAmountInput,
  minFillAmountUnits,
}) {
  return {
    baseToken,
    quoteToken,
    baseDecimals,
    quoteDecimals,
    amounts: {
      base: {
        units: baseAmountUnits.toString(),
        formatted: formatUnits(baseAmountUnits, baseDecimals),
      },
      quote: {
        units: quoteAmountUnits ? quoteAmountUnits.toString() : null,
        formatted: quoteAmountUnits ? formatUnits(quoteAmountUnits, quoteDecimals) : null,
      },
    },
    price: price !== null && price !== undefined ? Number(price) : null,
    priceSource,
    stopPrice: stopPriceValue !== null && stopPriceValue !== undefined ? Number(stopPriceValue) : null,
    minFillAmount: minFillAmountInput !== null && minFillAmountInput !== undefined ? Number(minFillAmountInput) : null,
    minFillAmountUnits: minFillAmountUnits ? minFillAmountUnits.toString() : null,
  };
}

async function prepare(orderInput = {}, options = {}) {
  const {
    includeTypedData = true,
    includeRawTypedData = false,
  } = options;

  const onchainInput = orderInput.onchain || {};
  const maker = ethers.getAddress(onchainInput.maker || orderInput.trader || orderInput.maker);
  const baseToken = ethers.getAddress(orderInput.baseToken || onchainInput.baseToken || orderInput.tokenGive);
  const quoteToken = ethers.getAddress(orderInput.quoteToken || onchainInput.quoteToken || orderInput.tokenGet);

  const side = resolveEnum(orderInput.side || onchainInput.side, ORDER_SIDE_INDEX, 'side', null);
  const orderType = resolveEnum(orderInput.orderType || onchainInput.orderType, ORDER_TYPE_INDEX, 'orderType', 'LIMIT');
  const timeInForce = resolveEnum(orderInput.timeInForce || onchainInput.timeInForce, TIME_IN_FORCE_INDEX, 'timeInForce', 'GTC');

  const baseTokenMeta = await tokenService.ensureTokenMetadata(baseToken);
  const quoteTokenMeta = await tokenService.ensureTokenMetadata(quoteToken);
  const baseDecimals = Number.isInteger(baseTokenMeta?.decimals) ? Number(baseTokenMeta.decimals) : 18;
  const quoteDecimals = Number.isInteger(quoteTokenMeta?.decimals) ? Number(quoteTokenMeta.decimals) : 18;

  const amountInputValue = orderInput.amount ?? orderInput.baseAmount ?? onchainInput.amountBase;
  const amountInputDisplay = toDecimalString(amountInputValue);
  const baseAmountUnits = parseUnitsSafe(amountInputValue, baseDecimals, 'amount');

  const priceInput = orderInput.price ?? orderInput.limitPrice ?? null;
  const priceInputDisplay = toDecimalString(priceInput);
  const explicitPriceProvided = priceInputDisplay !== null;
  let effectivePriceDisplay = priceInputDisplay;
  const amountGiveOverride = parseBigInt(onchainInput.amountGive, 'amountGive');
  const amountGetOverride = parseBigInt(onchainInput.amountGet, 'amountGet');
  const tokenGiveOverride = onchainInput.tokenGive ? ethers.getAddress(onchainInput.tokenGive) : null;
  const tokenGetOverride = onchainInput.tokenGet ? ethers.getAddress(onchainInput.tokenGet) : null;

  const tokenGive = tokenGiveOverride || (side.label === 'SELL' ? baseToken : quoteToken);
  const tokenGet = tokenGetOverride || (side.label === 'SELL' ? quoteToken : baseToken);

  let priceUnits = tryParseUnits(priceInput, quoteDecimals);
  let priceSource = priceUnits ? (explicitPriceProvided ? 'input' : 'derived') : null;

  if (!priceUnits && orderType.label === 'MARKET') {
    const marketSnapshot = matchingService.getMarketPriceSnapshot(baseToken, quoteToken);
    const rawMarketPrice =
      orderInput.marketPrice !== undefined && orderInput.marketPrice !== null
        ? orderInput.marketPrice
        : marketSnapshot?.price ?? null;
    const marketFallback = toDecimalString(rawMarketPrice);
    if (marketFallback !== null) {
      const marketUnits = tryParseUnits(marketFallback, quoteDecimals);
      if (marketUnits && marketUnits > 0n) {
        priceUnits = marketUnits;
        if (orderInput.marketPrice !== undefined && orderInput.marketPrice !== null) {
          priceSource = 'market';
        } else {
          priceSource = marketSnapshot?.source || 'market';
        }
        effectivePriceDisplay = marketFallback;
      }
    }

    if (!priceUnits) {
      const book = matchingService.getOrderBook(baseToken, quoteToken);
      const candidates = side.label === 'SELL' ? book?.buy : book?.sell;
      if (Array.isArray(candidates) && candidates.length > 0) {
        let bestPrice = null;
        for (const entry of candidates) {
          const candidatePrice = Number(entry?.price);
          if (!Number.isFinite(candidatePrice) || candidatePrice <= 0) {
            continue;
          }
          if (bestPrice === null) {
            bestPrice = candidatePrice;
            continue;
          }
          if (side.label === 'SELL') {
            if (candidatePrice > bestPrice) {
              bestPrice = candidatePrice;
            }
          } else if (candidatePrice < bestPrice) {
            bestPrice = candidatePrice;
          }
        }
        if (bestPrice !== null) {
          const bookPrice = toDecimalString(bestPrice);
          const bookUnits = tryParseUnits(bookPrice, quoteDecimals);
          if (bookUnits && bookUnits > 0n) {
            priceUnits = bookUnits;
            priceSource = 'orderbook';
            effectivePriceDisplay = bookPrice;
          }
        }
      }
    }

    if (!priceUnits) {
      const syntheticPrice = await priceOracleService.estimatePairPrice(baseToken, quoteToken, {
        baseTokenMeta,
        quoteTokenMeta,
      });
      const syntheticDisplay = toDecimalString(syntheticPrice);
      if (syntheticDisplay !== null) {
        const syntheticUnits = tryParseUnits(syntheticDisplay, quoteDecimals);
        if (syntheticUnits && syntheticUnits > 0n) {
          priceUnits = syntheticUnits;
          priceSource = 'synthetic';
          effectivePriceDisplay = syntheticDisplay;
        }
      }
    }
  }

  let quoteAmountUnits = null;

  if (amountGiveOverride !== null && amountGetOverride !== null) {
    quoteAmountUnits = side.label === 'SELL' ? amountGetOverride : amountGiveOverride;
    if (!priceUnits) {
      priceUnits = (quoteAmountUnits * 10n ** BigInt(baseDecimals)) / baseAmountUnits;
      if (priceUnits > 0n) {
        priceSource = priceSource || 'derived';
        effectivePriceDisplay = formatUnits(priceUnits, quoteDecimals);
      }
    }
  } else {
    if (!priceUnits) {
      if (orderType.label === 'MARKET') {
        throw new Error('market price is required to derive amountGet and amountGive');
      }
      throw new Error('price is required to derive amountGet and amountGive');
    }
    quoteAmountUnits = (baseAmountUnits * priceUnits) / 10n ** BigInt(baseDecimals);
    if (!priceSource) {
      priceSource = explicitPriceProvided ? 'input' : 'derived';
    }
  }

  const amountGive = amountGiveOverride !== null ? amountGiveOverride : side.label === 'SELL' ? baseAmountUnits : quoteAmountUnits;
  const amountGet = amountGetOverride !== null ? amountGetOverride : side.label === 'SELL' ? quoteAmountUnits : baseAmountUnits;

  if (!(amountGive > 0n) || !(amountGet > 0n)) {
    throw new Error('amountGet and amountGive must be greater than zero');
  }

  const priceDisplay = effectivePriceDisplay !== null
    ? Number(effectivePriceDisplay)
    : priceUnits
    ? Number(formatUnits(priceUnits, quoteDecimals))
    : null;

  const stopPriceInput = orderInput.stopPrice ?? onchainInput.stopPrice ?? null;
  const stopPriceDisplay = toDecimalString(stopPriceInput);
  let stopPrice = parseBigInt(stopPriceInput, 'stopPrice');
  if (stopPrice === null && stopPriceInput !== null && stopPriceInput !== undefined) {
    stopPrice = tryParseUnits(stopPriceInput, STOP_PRICE_SCALE);
  }
  if (stopPrice === null) {
    stopPrice = 0n;
  }

  const allowPartialFill = booleanFromInput(orderInput.allowPartialFill ?? onchainInput.allowPartialFill, true);

  const minFillInput = orderInput.minFillAmount ?? onchainInput.minFillAmount ?? null;
  const minFillDisplay = toDecimalString(minFillInput);
  let minFillAmountUnits = parseBigInt(minFillInput, 'minFillAmount');
  if (minFillAmountUnits === null && minFillInput !== null && minFillInput !== undefined) {
    const minBaseUnits = tryParseUnits(minFillInput, baseDecimals);
    if (minBaseUnits !== null) {
      if (side.label === 'SELL') {
        minFillAmountUnits = minBaseUnits;
      } else if (priceUnits) {
        minFillAmountUnits = (minBaseUnits * priceUnits) / 10n ** BigInt(baseDecimals);
      }
    }
  }
  if (minFillAmountUnits === null) {
    minFillAmountUnits = 0n;
  }

  const feeRecipient = onchainInput.feeRecipient ? ethers.getAddress(onchainInput.feeRecipient) : (orderInput.feeRecipient ? ethers.getAddress(orderInput.feeRecipient) : ethers.ZeroAddress);
  const feeAmount = parseBigInt(onchainInput.feeAmount ?? orderInput.feeAmount, 'feeAmount') ?? 0n;

  const nonce = await resolveNonce(maker, onchainInput.nonce ?? orderInput.nonce);
  const expiry = resolveExpiry(onchainInput.expiry ?? orderInput.expiry);

  const chainId = await resolveChainId(orderInput.chainId ?? onchainInput.chainId);
  const verifyingContract = ethers.getAddress(
    orderInput.verifyingContract || onchainInput.verifyingContract || blockchainService.getDexAddress(),
  );

  const rawOrder = {
    maker,
    tokenGet,
    amountGet,
    tokenGive,
    amountGive,
    nonce,
    expiry,
    orderType: orderType.index,
    timeInForce: timeInForce.index,
    side: side.index,
    stopPrice,
    minFillAmount: minFillAmountUnits,
    allowPartialFill,
    feeRecipient,
    feeAmount,
  };

  const domain = {
    name: 'DEX',
    version: '1',
    chainId,
    verifyingContract,
  };

  let typedData = null;
  let orderHash = null;
  let builtTypedData = null;

  if (includeTypedData) {
    builtTypedData = buildOrderTypedData(domain, rawOrder);
    const walletTypes = {
      ...builtTypedData.types,
      EIP712Domain: getEIP712DomainType(),
    };
    typedData = {
      domain: builtTypedData.domain,
      types: walletTypes,
      primaryType: 'Order',
      message: serializeTypedDataValue(builtTypedData.value),
    };
    orderHash = hashOrder(domain, rawOrder);
  }

  const onchain = buildOnchainStruct({
    maker,
    tokenGet,
    amountGet,
    tokenGive,
    amountGive,
    nonce,
    expiry,
    orderType,
    timeInForce,
    side,
    stopPrice,
    minFillAmount: minFillAmountUnits,
    allowPartialFill,
    feeRecipient,
    feeAmount,
  });

  const priceMetadataValue = effectivePriceDisplay ?? (priceUnits ? formatUnits(priceUnits, quoteDecimals) : null);
  const metadata = buildMetadata({
    baseToken,
    quoteToken,
    baseDecimals,
    quoteDecimals,
    baseAmountUnits,
    quoteAmountUnits,
    price: priceMetadataValue,
    priceSource,
    stopPriceValue: stopPriceDisplay,
    minFillAmountInput: minFillDisplay,
    minFillAmountUnits,
  });

  const amountNumber = amountInputDisplay !== null
    ? Number(amountInputDisplay)
    : Number(formatUnits(baseAmountUnits, baseDecimals));
  const priceNumber = priceDisplay !== null ? Number(priceDisplay) : null;
  const stopPriceNumber = stopPriceDisplay !== null ? Number(stopPriceDisplay) : null;
  const minFillNumber = minFillDisplay !== null ? Number(minFillDisplay) : null;

  const result = {
    trader: maker,
    baseToken,
    quoteToken,
    side: side.label,
    orderType: orderType.label,
    timeInForce: timeInForce.label,
    amount: amountNumber,
    price: priceNumber,
    allowPartialFill,
    nonce: nonce.toString(),
    expiry: expiry.toString(),
    stopPrice: stopPriceNumber,
    minFillAmount: minFillNumber,
    onchain,
    typedData,
    hash: orderHash,
    metadata,
  };

  if (includeTypedData && includeRawTypedData && builtTypedData) {
    result.rawTypedData = {
      domain: builtTypedData.domain,
      types: {
        ...builtTypedData.types,
        EIP712Domain: getEIP712DomainType(),
      },
      value: builtTypedData.value,
    };
    result.rawOrder = rawOrder;
  }

  return result;
}

module.exports = {
  prepare,
};
