const { ethers } = require('ethers');

const EIP712_DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

const ORDER_TYPE_FIELDS = [
  { name: 'maker', type: 'address' },
  { name: 'tokenGet', type: 'address' },
  { name: 'amountGet', type: 'uint256' },
  { name: 'tokenGive', type: 'address' },
  { name: 'amountGive', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiry', type: 'uint256' },
  { name: 'orderType', type: 'uint8' },
  { name: 'timeInForce', type: 'uint8' },
  { name: 'side', type: 'uint8' },
  { name: 'stopPrice', type: 'uint256' },
  { name: 'minFillAmount', type: 'uint256' },
  { name: 'allowPartialFill', type: 'bool' },
  { name: 'feeRecipient', type: 'address' },
  { name: 'feeAmount', type: 'uint256' },
];

const ORDER_TYPE_INDEX = {
  LIMIT: 0,
  MARKET: 1,
  STOP_LOSS: 2,
  STOP_LIMIT: 3,
};

const TIME_IN_FORCE_INDEX = {
  GTC: 0,
  IOC: 1,
  FOK: 2,
  POST_ONLY: 3,
};

const ORDER_SIDE_INDEX = {
  BUY: 0,
  SELL: 1,
};

function getOrderTypes() {
  return {
    Order: ORDER_TYPE_FIELDS,
  };
}

function getEIP712DomainType() {
  return EIP712_DOMAIN_FIELDS;
}

function normalizeAddress(value, label) {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  try {
    return ethers.getAddress(value);
  } catch (error) {
    throw new Error(`${label} must be a valid address`);
  }
}

function normalizeBigNumberish(value, label, { allowZero = true, defaultValue = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (defaultValue !== null && defaultValue !== undefined) {
      return BigInt(defaultValue);
    }
    if (allowZero) {
      return 0n;
    }
    throw new Error(`${label} is required`);
  }

  if (typeof value === 'bigint') {
    if (!allowZero && value === 0n) {
      throw new Error(`${label} must be greater than zero`);
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number`);
    }
    if (!allowZero && value === 0) {
      throw new Error(`${label} must be greater than zero`);
    }
    return BigInt(Math.trunc(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      if (defaultValue !== null && defaultValue !== undefined) {
        return BigInt(defaultValue);
      }
      if (allowZero) {
        return 0n;
      }
      throw new Error(`${label} is required`);
    }
    try {
      if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
        return BigInt(trimmed);
      }
      return BigInt(trimmed);
    } catch (error) {
      throw new Error(`${label} must be an integer string`);
    }
  }

  if (typeof value === 'object' && typeof value.toString === 'function') {
    return normalizeBigNumberish(value.toString(), label, { allowZero, defaultValue });
  }

  throw new Error(`${label} has unsupported type`);
}

function normalizeEnum(value, mapping, label, { defaultKey = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (defaultKey && Object.prototype.hasOwnProperty.call(mapping, defaultKey)) {
      return { index: mapping[defaultKey], label: defaultKey };
    }
    throw new Error(`${label} is required`);
  }

  if (typeof value === 'number') {
    const numeric = Math.trunc(value);
    for (const [key, index] of Object.entries(mapping)) {
      if (index === numeric) {
        return { index, label: key };
      }
    }
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

  throw new Error(`${label} value ${value} is not supported`);
}

function normalizeOrderStruct(order) {
  if (!order || typeof order !== 'object') {
    throw new Error('Order struct is required');
  }

  const maker = normalizeAddress(order.maker, 'maker');
  const tokenGet = normalizeAddress(order.tokenGet, 'tokenGet');
  const tokenGive = normalizeAddress(order.tokenGive, 'tokenGive');
  const amountGet = normalizeBigNumberish(order.amountGet, 'amountGet', { allowZero: false });
  const amountGive = normalizeBigNumberish(order.amountGive, 'amountGive', { allowZero: false });
  const nonce = normalizeBigNumberish(order.nonce, 'nonce');
  const expiry = normalizeBigNumberish(order.expiry, 'expiry');
  const orderType = normalizeEnum(order.orderType, ORDER_TYPE_INDEX, 'orderType', { defaultKey: 'LIMIT' });
  const timeInForce = normalizeEnum(order.timeInForce, TIME_IN_FORCE_INDEX, 'timeInForce', { defaultKey: 'GTC' });
  const side = normalizeEnum(order.side, ORDER_SIDE_INDEX, 'side');
  const stopPrice = normalizeBigNumberish(order.stopPrice, 'stopPrice');
  const minFillAmount = normalizeBigNumberish(order.minFillAmount, 'minFillAmount');
  const allowPartialFill = Boolean(order.allowPartialFill);
  const feeRecipient = order.feeRecipient ? normalizeAddress(order.feeRecipient, 'feeRecipient') : ethers.ZeroAddress;
  const feeAmount = normalizeBigNumberish(order.feeAmount, 'feeAmount');

  return {
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
    minFillAmount,
    allowPartialFill,
    feeRecipient,
    feeAmount,
  };
}

function buildOrderTypedData(domain, order) {
  if (!domain || typeof domain !== 'object') {
    throw new Error('Typed data domain is required');
  }

  const normalizedDomain = {
    name: domain.name || 'DEX',
    version: domain.version || '1',
  };

  if (domain.chainId === undefined || domain.chainId === null) {
    throw new Error('domain.chainId is required');
  }

  const chainIdNumeric = Number(domain.chainId);
  if (!Number.isInteger(chainIdNumeric)) {
    throw new Error('domain.chainId must be an integer');
  }
  normalizedDomain.chainId = chainIdNumeric;

  if (!domain.verifyingContract) {
    throw new Error('domain.verifyingContract is required');
  }
  normalizedDomain.verifyingContract = normalizeAddress(domain.verifyingContract, 'domain.verifyingContract');

  const value = normalizeOrderStruct(order);
  const types = getOrderTypes();
  return { domain: normalizedDomain, types, value };
}

function hashOrder(domain, order) {
  const typedData = buildOrderTypedData(domain, order);
  return ethers.TypedDataEncoder.hash(typedData.domain, typedData.types, typedData.value);
}

async function signOrder(signer, domain, order) {
  if (!signer || typeof signer.signTypedData !== 'function') {
    throw new Error('A signer instance with signTypedData is required');
  }
  const typedData = buildOrderTypedData(domain, order);
  return signer.signTypedData(typedData.domain, typedData.types, typedData.value);
}

function recoverOrderSigner(domain, order, signature) {
  if (!signature) {
    throw new Error('signature is required');
  }
  const typedData = buildOrderTypedData(domain, order);
  return ethers.verifyTypedData(typedData.domain, typedData.types, typedData.value, signature);
}

function verifyOrderSignature(domain, order, signature, expectedSigner) {
  const recovered = recoverOrderSigner(domain, order, signature);
  if (!expectedSigner) {
    return recovered;
  }
  return normalizeAddress(recovered, 'recoveredSigner') === normalizeAddress(expectedSigner, 'expectedSigner');
}

function serializeTypedDataValue(value) {
  const serialized = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === 'bigint') {
      serialized[key] = fieldValue.toString();
    } else {
      serialized[key] = fieldValue;
    }
  }
  return serialized;
}

module.exports = {
  ORDER_TYPE_FIELDS,
  ORDER_TYPE_INDEX,
  TIME_IN_FORCE_INDEX,
  ORDER_SIDE_INDEX,
  getOrderTypes,
  getEIP712DomainType,
  buildOrderTypedData,
  hashOrder,
  signOrder,
  recoverOrderSigner,
  verifyOrderSignature,
  normalizeOrderStruct,
  serializeTypedDataValue,
};
