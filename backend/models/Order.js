const ORDER_TYPE_MAP = {
  LIMIT: 'LIMIT',
  MARKET: 'MARKET',
  STOP_LOSS: 'STOP_LOSS',
  STOP_LIMIT: 'STOP_LIMIT',
  '0': 'LIMIT',
  '1': 'MARKET',
  '2': 'STOP_LOSS',
  '3': 'STOP_LIMIT',
};

const TIME_IN_FORCE_MAP = {
  GTC: 'GTC',
  IOC: 'IOC',
  FOK: 'FOK',
  POST_ONLY: 'POST_ONLY',
  '0': 'GTC',
  '1': 'IOC',
  '2': 'FOK',
  '3': 'POST_ONLY',
};

const ORDER_SIDE_MAP = {
  BUY: 'BUY',
  SELL: 'SELL',
  '0': 'BUY',
  '1': 'SELL',
};

function normalizeEnum(value, mapping, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback ?? null;
  }

  const candidateKeys = [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    candidateKeys.push(trimmed);
    candidateKeys.push(trimmed.toUpperCase());
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      candidateKeys.push(String(numeric));
    }
  } else if (typeof value === 'number') {
    candidateKeys.push(String(value));
  }

  candidateKeys.push(String(value));
  candidateKeys.push(String(value).toUpperCase());

  for (const key of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(mapping, key)) {
      return mapping[key];
    }
  }

  return fallback ?? null;
}

function normalizeNumericString(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Number.isInteger(value) ? String(value) : value.toString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return String(value);
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

class Order {
  constructor(input = {}) {
    const {
      id,
      trader,
      baseToken,
      quoteToken,
      side,
      price = null,
      amount,
      filled = 0,
      status = 'PENDING',
      signature = '',
      orderType = 'LIMIT',
      timeInForce = 'GTC',
      stopPrice = null,
      allowPartialFill = true,
      triggeredAt = null,
      metadata = {},
      createdAt = new Date(),
      updatedAt = new Date(),
    } = input;
    if (!id) {
      throw new Error('Order id is required');
    }
    if (!trader) {
      throw new Error('Order trader is required');
    }
    if (!baseToken || !quoteToken) {
      throw new Error('Order must specify baseToken and quoteToken');
    }
    if (side === undefined || side === null) {
      throw new Error('Order side is required');
    }
    if (amount === undefined || amount === null) {
      throw new Error('Order amount is required');
    }

    this.id = id;
    this.trader = trader;
    this.baseToken = baseToken;
    this.quoteToken = quoteToken;
    const normalizedSide = normalizeEnum(side, ORDER_SIDE_MAP, null);
    if (!normalizedSide) {
      throw new Error('Order side is invalid');
    }
    this.side = normalizedSide;
    this.price = price !== null && price !== undefined ? Number(price) : null;
    if (this.price !== null && Number.isNaN(this.price)) {
      throw new Error('Order price must be a valid number');
    }

    this.amount = Number(amount);
    if (Number.isNaN(this.amount) || this.amount <= 0) {
      throw new Error('Order amount must be a positive number');
    }

    this.filled = Number(filled) || 0;
    if (Number.isNaN(this.filled) || this.filled < 0) {
      throw new Error('Order filled amount must be zero or positive');
    }
    const normalizedStatus = String(status || 'PENDING').toUpperCase();
    this.status = normalizedStatus === 'OPEN' ? 'PENDING' : normalizedStatus;
    this.signature = signature;
    this.nonce = normalizeNumericString(input.nonce ?? input.onchain?.nonce ?? null);
    const expiryInput = input.expiry ?? input.onchain?.expiry ?? null;
    if (expiryInput === null || expiryInput === undefined || expiryInput === '') {
      this.expiry = null;
    } else if (expiryInput instanceof Date) {
      this.expiry = expiryInput.getTime ? Math.floor(expiryInput.getTime() / 1000) : null;
    } else {
      const parsedExpiry = Number(expiryInput);
      this.expiry = Number.isFinite(parsedExpiry) ? parsedExpiry : null;
    }
    const normalizedOrderType = normalizeEnum(orderType, ORDER_TYPE_MAP, null);
    if (normalizedOrderType) {
      this.orderType = normalizedOrderType;
    } else if (orderType === undefined || orderType === null || orderType === '') {
      this.orderType = 'LIMIT';
    } else {
      throw new Error('Order type is invalid');
    }

    const normalizedTif = normalizeEnum(timeInForce, TIME_IN_FORCE_MAP, null);
    if (normalizedTif) {
      this.timeInForce = normalizedTif;
    } else if (timeInForce === undefined || timeInForce === null || timeInForce === '') {
      this.timeInForce = 'GTC';
    } else {
      throw new Error('Time-in-force is invalid');
    }
    this.stopPrice = stopPrice !== null && stopPrice !== undefined ? Number(stopPrice) : null;
    if (this.stopPrice !== null && Number.isNaN(this.stopPrice)) {
      throw new Error('Order stop price must be a valid number');
    }
    if (allowPartialFill === undefined || allowPartialFill === null) {
      this.allowPartialFill = true;
    } else if (typeof allowPartialFill === 'string') {
      const normalized = allowPartialFill.trim().toLowerCase();
      this.allowPartialFill = !['false', '0', 'no'].includes(normalized);
    } else {
      this.allowPartialFill = Boolean(allowPartialFill);
    }
    this.minFillAmount = input.minFillAmount ?? input.onchain?.minFillAmount ?? null;
    if (this.minFillAmount !== null && this.minFillAmount !== undefined) {
      const numericMinFill = Number(this.minFillAmount);
      if (Number.isNaN(numericMinFill)) {
        throw new Error('minFillAmount must be a valid number');
      }
      this.minFillAmount = numericMinFill;
    }
    this.feeRecipient = input.feeRecipient || input.onchain?.feeRecipient || null;
    this.feeAmount = input.feeAmount ?? input.onchain?.feeAmount ?? null;
    if (this.feeAmount !== null && this.feeAmount !== undefined) {
      const numericFeeAmount = Number(this.feeAmount);
      if (Number.isNaN(numericFeeAmount)) {
        throw new Error('feeAmount must be a valid number');
      }
      this.feeAmount = numericFeeAmount;
    }
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      this.metadata = { ...metadata };
    } else {
      this.metadata = {};
    }

    this.onchain = this._normalizeOnchain(input.onchain || {});

    this.createdAt = createdAt instanceof Date ? createdAt : new Date(createdAt);
    this.updatedAt = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
    this.triggeredAt = triggeredAt instanceof Date ? triggeredAt : triggeredAt ? new Date(triggeredAt) : null;

    this.executions = [];
  }

  get remaining() {
    const remainingAmount = this.amount - this.filled;
    return remainingAmount > 0 ? remainingAmount : 0;
  }

  isBuy() {
    return this.side === 'BUY';
  }

  isSell() {
    return this.side === 'SELL';
  }

  isStopOrder() {
    return this.orderType === 'STOP_LOSS' || this.orderType === 'STOP_LIMIT';
  }

  markTriggered(triggerTime = new Date()) {
    this.triggeredAt = triggerTime instanceof Date ? triggerTime : new Date(triggerTime);
    this.status = 'TRIGGERED';
    this.updatedAt = this.triggeredAt;
  }

  recordFill(amount, price, counterpartyId, timestamp = new Date()) {
    const fillAmount = Number(amount);
    if (Number.isNaN(fillAmount) || fillAmount <= 0) {
      return null;
    }

    const executionPrice = price !== null && price !== undefined ? Number(price) : null;
    const execution = {
      amount: fillAmount,
      price: executionPrice,
      counterparty: counterpartyId || null,
      timestamp,
    };

    this.filled += fillAmount;
    if (this.remaining <= 0) {
      this.status = 'FILLED';
    } else {
      this.status = 'PARTIAL';
    }

    this.updatedAt = timestamp;
    this.executions.push(execution);
    return execution;
  }

  cancel(reason = 'CANCELLED') {
    this.status = 'CANCELLED';
    this.metadata = this.metadata || {};
    this.metadata.cancelReason = reason;
    this.updatedAt = new Date();
  }

  toJSON() {
    return {
      id: this.id,
      trader: this.trader,
      baseToken: this.baseToken,
      quoteToken: this.quoteToken,
      side: this.side,
      price: this.price,
      amount: this.amount,
      filled: this.filled,
      remaining: this.remaining,
      status: this.status,
      signature: this.signature,
      nonce: this.nonce,
      expiry: this.expiry,
      orderType: this.orderType,
      timeInForce: this.timeInForce,
      stopPrice: this.stopPrice,
      allowPartialFill: this.allowPartialFill,
      minFillAmount: this.minFillAmount,
      feeRecipient: this.feeRecipient,
      feeAmount: this.feeAmount,
      triggeredAt: toIsoOrNull(this.triggeredAt),
      metadata: this._serializeMetadata(),
      createdAt: toIsoOrNull(this.createdAt),
      updatedAt: toIsoOrNull(this.updatedAt),
      executions: this.executions.map((execution) => ({
        amount: execution.amount,
        price: execution.price,
        counterparty: execution.counterparty,
        timestamp: toIsoOrNull(execution.timestamp),
      })),
      onchain: this._serializeOnchain(),
    };
  }

  _serializeMetadata() {
    if (!this.metadata || typeof this.metadata !== 'object') {
      return {};
    }
    const serialized = { ...this.metadata };
    if (serialized.trades && Array.isArray(serialized.trades)) {
      serialized.trades = serialized.trades.map((trade) => ({
        ...trade,
        timestamp: toIsoOrNull(trade.timestamp),
      }));
    }
    if (serialized.batchExecutions && Array.isArray(serialized.batchExecutions)) {
      serialized.batchExecutions = serialized.batchExecutions.map((execution) => ({
        ...execution,
        executedAt: toIsoOrNull(execution.executedAt),
      }));
    }
    if (serialized.lastTradeAt) {
      serialized.lastTradeAt = toIsoOrNull(serialized.lastTradeAt);
    }
    if (serialized.queuedAt) {
      serialized.queuedAt = toIsoOrNull(serialized.queuedAt);
    }
    if (serialized.triggeredAt) {
      serialized.triggeredAt = toIsoOrNull(serialized.triggeredAt);
    }
    return serialized;
  }

  _normalizeOnchain(onchainInput) {
    const normalized = {};
    if (!onchainInput || typeof onchainInput !== 'object') {
      if (this.trader) {
        normalized.maker = this.trader;
      }
      return normalized;
    }

    const entries = {
      maker: onchainInput.maker || this.trader || null,
      tokenGet: onchainInput.tokenGet || null,
      amountGet: normalizeNumericString(onchainInput.amountGet),
      tokenGive: onchainInput.tokenGive || null,
      amountGive: normalizeNumericString(onchainInput.amountGive),
      nonce: normalizeNumericString(onchainInput.nonce ?? this.nonce ?? null),
      expiry: normalizeNumericString(onchainInput.expiry ?? this.expiry ?? null),
      orderType: normalizeEnum(onchainInput.orderType, ORDER_TYPE_MAP, this.orderType),
      timeInForce: normalizeEnum(onchainInput.timeInForce, TIME_IN_FORCE_MAP, this.timeInForce),
      side: normalizeEnum(onchainInput.side, ORDER_SIDE_MAP, this.side),
      stopPrice: normalizeNumericString(onchainInput.stopPrice ?? this.stopPrice ?? null),
      minFillAmount: normalizeNumericString(
        onchainInput.minFillAmount ?? this.minFillAmount ?? null,
      ),
      allowPartialFill:
        onchainInput.allowPartialFill !== undefined
          ? Boolean(onchainInput.allowPartialFill)
          : this.allowPartialFill,
      feeRecipient: onchainInput.feeRecipient || this.feeRecipient || null,
      feeAmount: normalizeNumericString(onchainInput.feeAmount ?? this.feeAmount ?? null),
      signature: onchainInput.signature || this.signature || '',
    };

    for (const [key, value] of Object.entries(entries)) {
      if (value !== null && value !== undefined && value !== '') {
        normalized[key] = value;
      }
    }

    return normalized;
  }

  _serializeOnchain() {
    if (!this.onchain || typeof this.onchain !== 'object') {
      return {};
    }
    const serialized = {};
    for (const [key, value] of Object.entries(this.onchain)) {
      if (value === undefined) {
        continue;
      }
      if (value instanceof Date) {
        serialized[key] = value.toISOString();
      } else if (typeof value === 'bigint') {
        serialized[key] = value.toString();
      } else {
        serialized[key] = value;
      }
    }
    return serialized;
  }
}

module.exports = Order;
