const { ethers } = require('ethers');
const blockchainService = require('./blockchain.service');
const logger = require('../utils/logger');

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

function toBigNumberish(value, label) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${label} is required`);
  }
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a finite number`);
    }
    if (!Number.isInteger(value)) {
      throw new Error(`${label} must be expressed in base units (integer)`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new Error(`${label} is required`);
    }
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      return BigInt(trimmed);
    }
    if (trimmed.includes('.')) {
      throw new Error(`${label} must be an integer string without decimals`);
    }
    return BigInt(trimmed);
  }
  if (value && typeof value === 'object' && typeof value.toString === 'function') {
    const stringified = value.toString();
    if (!stringified || stringified.includes('.')) {
      throw new Error(`${label} must resolve to an integer string`);
    }
    return BigInt(stringified);
  }
  throw new Error(`${label} has unsupported type`);
}

function toEnumIndex(value, mapping, fallback, label) {
  const normalized = typeof value === 'string' ? value.toUpperCase() : value;
  if (normalized in mapping) {
    return mapping[normalized];
  }
  if (fallback && fallback in mapping) {
    return mapping[fallback];
  }
  throw new Error(`${label} value ${value} is not supported`);
}

function serializeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') {
    return null;
  }
  return {
    transactionHash: receipt.hash || receipt.transactionHash || '',
    blockNumber: receipt.blockNumber ?? null,
    gasUsed: receipt.gasUsed?.toString?.() ?? null,
    cumulativeGasUsed: receipt.cumulativeGasUsed?.toString?.() ?? null,
    status: receipt.status ?? null,
  };
}

class SettlementService {
  async settleTrade({ trade, makerOrder, takerOrder }) {
    if (!makerOrder) {
      throw new Error('Maker order is required for settlement');
    }

    const onchain = makerOrder.onchain || {};
    const signature = onchain.signature || makerOrder.signature;
    if (!signature) {
      throw new Error('Maker order signature is missing');
    }

    const contractOrder = this._buildContractOrder(makerOrder);
    const fillAmount = this._resolveFillAmount(trade, makerOrder, takerOrder);

    const signer = blockchainService.getSigner();
    if (!signer) {
      throw new Error('Blockchain signer is not configured for settlement');
    }

    const contract = blockchainService.getDexContract();
    const connected = contract.connect(signer);

    const tx = await connected.executeOrder(contractOrder, signature, fillAmount);
    const receipt = await tx.wait(blockchainService.confirmations);
    return {
      success: true,
      receipt: serializeReceipt(receipt),
    };
  }

  _buildContractOrder(order) {
    const onchain = order.onchain || {};
    const maker = onchain.maker || order.trader;
    if (!maker) {
      throw new Error('Order maker address is required');
    }
    const tokenGet = onchain.tokenGet || (order.isSell() ? order.quoteToken : order.baseToken);
    const tokenGive = onchain.tokenGive || (order.isSell() ? order.baseToken : order.quoteToken);
    if (!tokenGet || !tokenGive) {
      throw new Error('tokenGet and tokenGive must be specified for settlement');
    }

    const amountGet = toBigNumberish(onchain.amountGet, 'amountGet');
    const amountGive = toBigNumberish(onchain.amountGive, 'amountGive');

    return {
      maker,
      tokenGet,
      amountGet,
      tokenGive,
      amountGive,
      nonce: toBigNumberish(onchain.nonce ?? order.nonce ?? 0, 'nonce'),
      expiry: toBigNumberish(onchain.expiry ?? order.expiry ?? 0, 'expiry'),
      orderType: toEnumIndex(onchain.orderType || order.orderType, ORDER_TYPE_INDEX, 'LIMIT', 'orderType'),
      timeInForce: toEnumIndex(
        onchain.timeInForce || order.timeInForce,
        TIME_IN_FORCE_INDEX,
        'GTC',
        'timeInForce',
      ),
      side: toEnumIndex(onchain.side || order.side, ORDER_SIDE_INDEX, 'SELL', 'side'),
      stopPrice: toBigNumberish(onchain.stopPrice ?? order.stopPrice ?? 0, 'stopPrice'),
      minFillAmount: toBigNumberish(onchain.minFillAmount ?? order.minFillAmount ?? 0, 'minFillAmount'),
      allowPartialFill:
        onchain.allowPartialFill !== undefined ? Boolean(onchain.allowPartialFill) : order.allowPartialFill,
      feeRecipient: onchain.feeRecipient || order.feeRecipient || ethers.ZeroAddress,
      feeAmount: toBigNumberish(onchain.feeAmount ?? order.feeAmount ?? 0, 'feeAmount'),
    };
  }

  _resolveFillAmount(trade, makerOrder, takerOrder) {
    const onchain = makerOrder.onchain || {};
    if (onchain.fillAmount) {
      return toBigNumberish(onchain.fillAmount, 'fillAmount');
    }

    if (trade && trade.fillAmount) {
      try {
        return toBigNumberish(trade.fillAmount, 'fillAmount');
      } catch (error) {
        logger.warn('Failed to use trade.fillAmount for settlement', {
          error: error.message,
          trade,
        });
      }
    }

    if (trade && trade.amount) {
      try {
        return toBigNumberish(trade.amount, 'fillAmount');
      } catch (error) {
        logger.warn('Failed to convert trade.amount to fillAmount', {
          error: error.message,
          trade,
        });
      }
    }

    if (takerOrder?.onchain?.fillAmount) {
      return toBigNumberish(takerOrder.onchain.fillAmount, 'fillAmount');
    }

    throw new Error('Unable to determine fill amount for settlement');
  }
}

module.exports = new SettlementService();
