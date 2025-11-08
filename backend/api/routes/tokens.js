const express = require('express');
const tokenService = require('../../services/token.service');

const router = express.Router();

router.get('/', (req, res) => {
  const tokens = tokenService.listTokens();
  res.json(tokens);
});

router.get('/:address', async (req, res) => {
  try {
    const token = await tokenService.ensureTokenMetadata(req.params.address);
    if (!token) {
      return res.status(404).json({ message: 'Token not found' });
    }
    return res.json(token);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const token = tokenService.registerToken(req.body);
    return res.status(201).json(token);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/issue', async (req, res) => {
  try {
    const token = await tokenService.issueToken(req.body);
    return res.status(201).json(token);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

module.exports = router;
