const express = require('express');
const { ethers } = require('ethers');
const blockchainService = require('../../services/blockchain.service');
const tokenService = require('../../services/token.service');
const config = require('../../config/config');

const router = express.Router();

function parseAmount(value, label = 'amount') {
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
      throw new Error(`${label} must be expressed as an integer (token base units)`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new Error(`${label} is required`);
    }
    if (trimmed.includes('.')) {
      throw new Error(`${label} must not contain decimals. Provide base units`);
    }
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      return BigInt(trimmed);
    }
    return BigInt(trimmed);
  }
  throw new Error(`${label} has unsupported type`);
}

function buildReceiptResponse(receipt) {
  if (!receipt || typeof receipt !== 'object') {
    return null;
  }
  return {
    transactionHash: receipt.hash || receipt.transactionHash || '',
    blockNumber: receipt.blockNumber ?? null,
    gasUsed: receipt.gasUsed?.toString?.() ?? null,
    cumulativeGasUsed: receipt.cumulativeGasUsed?.toString?.() ?? null,
    status: receipt.status ?? null,
    logs: Array.isArray(receipt.logs)
      ? receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
        }))
      : [],
  };
}

function resolveSigner(privateKey) {
  if (privateKey) {
    const provider = blockchainService.getProvider();
    if (!provider) {
      throw new Error('Blockchain provider is not configured');
    }
    return new ethers.Wallet(privateKey, provider);
  }
  const signer = blockchainService.getSigner();
  if (!signer) {
    throw new Error('No signer configured. Provide a privateKey or configure backend signer');
  }
  return signer;
}

router.get('/config', (req, res) => {
  res.json({
    network: config.blockchain.network,
    dexAddress: blockchainService.getDexAddress(),
    confirmations: blockchainService.confirmations,
    hasSigner: Boolean(blockchainService.getSigner()),
  });
});

router.get('/nonce/:address', async (req, res) => {
  const { address } = req.params;
  try {
    const contract = blockchainService.getDexContract();
    const nonce = await contract.getNonce(address);
    return res.json({ address, nonce: nonce.toString() });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.get('/balances/:address', async (req, res) => {
  const { address } = req.params;
  const tokens = tokenService.listTokens();
  try {
    const balances = await Promise.all(
      tokens.map(async (token) => {
        try {
          const balance = await blockchainService.getDexBalance(address, token.address);
          return { token, balance };
        } catch (error) {
          return { token, balance: '0', error: error.message };
        }
      }),
    );
    return res.json({ address, balances });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/deposit', async (req, res) => {
  const { token, amount, privateKey, autoApprove = false } = req.body || {};
  if (!token) {
    return res.status(400).json({ message: 'token is required' });
  }
  try {
    const signer = resolveSigner(privateKey);
    const amountValue = parseAmount(amount, 'amount');
    const contract = blockchainService.getDexContract();
    const connected = contract.connect(signer);

    if (autoApprove) {
      try {
        const erc20 = blockchainService.getErc20Contract(token, { signer });
        const approveTx = await erc20.approve(blockchainService.getDexAddress(), amountValue);
        await approveTx.wait(blockchainService.confirmations);
      } catch (error) {
        return res.status(400).json({
          message: `Approval failed: ${error.message}`,
        });
      }
    }

    const tx = await connected.deposit(token, amountValue);
    const receipt = await tx.wait(blockchainService.confirmations);
    return res.json({
      token,
      amount: amountValue.toString(),
      receipt: buildReceiptResponse(receipt),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/withdraw', async (req, res) => {
  const { token, amount, privateKey } = req.body || {};
  if (!token) {
    return res.status(400).json({ message: 'token is required' });
  }
  try {
    const signer = resolveSigner(privateKey);
    const amountValue = parseAmount(amount, 'amount');
    const contract = blockchainService.getDexContract();
    const connected = contract.connect(signer);
    const tx = await connected.withdraw(token, amountValue);
    const receipt = await tx.wait(blockchainService.confirmations);
    return res.json({
      token,
      amount: amountValue.toString(),
      receipt: buildReceiptResponse(receipt),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/execute', async (req, res) => {
  const { order, signature, fillAmount, privateKey, overrides = {} } = req.body || {};
  if (!order || !signature) {
    return res.status(400).json({ message: 'order and signature are required' });
  }
  try {
    const signer = resolveSigner(privateKey);
    const fillValue = parseAmount(fillAmount, 'fillAmount');
    const contract = blockchainService.getDexContract();
    const connected = contract.connect(signer);
    const tx = await connected.executeOrder(order, signature, fillValue, overrides);
    const receipt = await tx.wait(blockchainService.confirmations);
    return res.json({
      receipt: buildReceiptResponse(receipt),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/execute-market', async (req, res) => {
  const { order, signature, maxSlippage, privateKey } = req.body || {};
  if (!order || !signature) {
    return res.status(400).json({ message: 'order and signature are required' });
  }
  try {
    const signer = resolveSigner(privateKey);
    const contract = blockchainService.getDexContract();
    const connected = contract.connect(signer);
    const tx = await connected.executeMarketOrder(order, signature, parseAmount(maxSlippage ?? 0, 'maxSlippage'));
    const receipt = await tx.wait(blockchainService.confirmations);
    return res.json({
      receipt: buildReceiptResponse(receipt),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/cancel', async (req, res) => {
  const { order, privateKey } = req.body || {};
  if (!order) {
    return res.status(400).json({ message: 'order is required' });
  }
  try {
    const signer = resolveSigner(privateKey);
    const contract = blockchainService.getDexContract();
    const connected = contract.connect(signer);
    const tx = await connected.cancelOrder(order);
    const receipt = await tx.wait(blockchainService.confirmations);
    return res.json({
      receipt: buildReceiptResponse(receipt),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/cancel-batch', async (req, res) => {
  const { orders, privateKey } = req.body || {};
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ message: 'orders array is required' });
  }
  try {
    const signer = resolveSigner(privateKey);
    const contract = blockchainService.getDexContract();
    const connected = contract.connect(signer);
    const tx = await connected.cancelOrders(orders);
    const receipt = await tx.wait(blockchainService.confirmations);
    return res.json({
      receipt: buildReceiptResponse(receipt),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/nonce/increment', async (req, res) => {
  const { privateKey } = req.body || {};
  try {
    const signer = resolveSigner(privateKey);
    const contract = blockchainService.getDexContract();
    const connected = contract.connect(signer);
    const tx = await connected.incrementNonce();
    const receipt = await tx.wait(blockchainService.confirmations);
    return res.json({
      receipt: buildReceiptResponse(receipt),
    });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

module.exports = router;
