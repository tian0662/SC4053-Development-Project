const express = require('express');
const { ethers } = require('ethers');
const userService = require('../../services/user.service');
const tokenService = require('../../services/token.service');
const blockchainService = require('../../services/blockchain.service');

function normalizeAddress(address) {
  if (!address) {
    return '';
  }

  try {
    return ethers.getAddress(address);
  } catch (error) {
    return String(address).toLowerCase();
  }
}

function isSameAddress(a, b) {
  if (!a || !b) {
    return false;
  }

  return normalizeAddress(a) === normalizeAddress(b);
}

const router = express.Router();

router.get('/', (req, res) => {
  const users = userService.listUsers();
  res.json(users);
});

router.post('/', (req, res) => {
  try {
    const user = userService.registerUser(req.body);
    return res.status(201).json(user);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.get('/:address', (req, res) => {
  const user = userService.getUser(req.params.address);
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  return res.json(user);
});

router.get('/:address/balances', async (req, res) => {
  const { address } = req.params;
  const { tokens: tokensQuery, includeWallet } = req.query;
  const includeWalletBalance = String(includeWallet || '').toLowerCase() === 'true';

  try {
    const tokenAddresses = tokensQuery
      ? tokensQuery.split(',').map((token) => token.trim()).filter(Boolean)
      : tokenService.listTokens().map((token) => token.address);

    const balanceResults = await Promise.all(
      tokenAddresses.map(async (tokenAddress) => {
        const tokenMeta = tokenService.getToken(tokenAddress) || { address: tokenAddress };
        const result = { token: tokenMeta };
        try {
          result.dexBalance = await blockchainService.getDexBalance(address, tokenAddress);
        } catch (error) {
          result.dexBalance = '0';
          result.dexBalanceError = error.message;
        }

        if (includeWalletBalance) {
          let walletLookupError = null;
          try {
            result.walletBalance = await blockchainService.getTokenBalance(tokenAddress, address);
          } catch (error) {
            walletLookupError = error;
            result.walletBalance = '0';
            result.walletBalanceError = error.message;
          }

          if (
            walletLookupError &&
            result.walletBalance === '0' &&
            tokenMeta?.totalSupply &&
            tokenMeta?.issuer &&
            isSameAddress(tokenMeta.issuer, address)
          ) {
            result.walletBalance = String(tokenMeta.totalSupply);
            result.walletBalanceSource = 'registeredTotalSupply';
          }
        }

        return result;
      }),
    );

    return res.json({ address, balances: balanceResults });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

module.exports = router;
