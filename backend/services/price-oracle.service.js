const crypto = require('crypto');
const { ethers } = require('ethers');
const tokenService = require('./token.service');

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

function parseSupply(meta) {
  if (!meta || meta.totalSupply === undefined || meta.totalSupply === null) {
    return null;
  }
  try {
    const decimals = Number.isInteger(meta.decimals) ? Number(meta.decimals) : 18;
    const supplyBigInt = BigInt(meta.totalSupply);
    if (!(supplyBigInt > 0n)) {
      return null;
    }
    const formatted = Number(ethers.formatUnits(supplyBigInt, decimals));
    if (!Number.isFinite(formatted) || !(formatted > 0)) {
      return null;
    }
    return formatted;
  } catch (error) {
    return null;
  }
}

function deterministicMultiplier(meta, fallbackAddress) {
  const address = normalizeAddress(meta?.address || fallbackAddress || '');
  const symbol = typeof meta?.symbol === 'string' ? meta.symbol.toUpperCase() : '';
  const name = typeof meta?.name === 'string' ? meta.name.toUpperCase() : '';
  const seed = `${address}|${symbol}|${name}`;
  const hash = crypto.createHash('sha256').update(seed || 'synthetic-price').digest();
  const bucket = hash.readUInt32BE(0);
  const fraction = bucket / 0xffffffff;
  const base = 0.5 + fraction * 1.5; // range [0.5, 2.0]
  const symbolFactor = symbol ? 1 + ((symbol.length % 5) * 0.05) : 1;
  return base * symbolFactor;
}

function deriveUnitValue(meta, fallbackAddress) {
  const supply = parseSupply(meta);
  let intrinsic = null;
  if (supply !== null && supply > 0) {
    intrinsic = 1 / supply;
  }
  if (intrinsic === null || !(intrinsic > 0)) {
    intrinsic = 1;
  }
  intrinsic *= deterministicMultiplier(meta, fallbackAddress);
  if (!(intrinsic > 0)) {
    intrinsic = 1;
  }
  const clampMin = 1e-12;
  const clampMax = 1e12;
  if (intrinsic < clampMin) {
    intrinsic = clampMin;
  } else if (intrinsic > clampMax) {
    intrinsic = clampMax;
  }
  return intrinsic;
}

function formatPositiveNumber(value) {
  if (!Number.isFinite(value) || !(value > 0)) {
    return null;
  }
  const abs = Math.abs(value);
  if (abs >= 1e12) {
    return Math.round(value).toString();
  }
  const text = value.toString();
  if (!/[eE]/.test(text)) {
    return text;
  }
  const decimals = Math.min(18, Math.max(2, Math.ceil(-Math.log10(abs)) + 6));
  return value.toFixed(decimals);
}

class PriceOracleService {
  constructor() {
    this.unitValueCache = new Map();
    this.pairStates = new Map();
    this.defaultLiquidityScore = 1000;
    this.liquidityDecay = 0.85;
    this.directionalImpactScale = 0.1;
    this.minPrice = 1e-12;
    this.maxPrice = 1e12;
  }

  getCachedPairSnapshot(baseToken, quoteToken) {
    const descriptor = this._getCanonicalDescriptor(baseToken, quoteToken);
    if (!descriptor) {
      return null;
    }

    const state = this.pairStates.get(descriptor.key);
    if (!state) {
      return null;
    }

    const price = this._getPriceFromState(state, descriptor);
    if (!Number.isFinite(price) || price <= 0) {
      return null;
    }

    const updatedAt = state.lastUpdatedAt instanceof Date && !Number.isNaN(state.lastUpdatedAt.getTime())
      ? new Date(state.lastUpdatedAt.getTime())
      : null;

    return {
      price,
      source: state.lastSource || 'synthetic',
      updatedAt,
    };
  }

  _getCanonicalDescriptor(baseToken, quoteToken) {
    const baseAddress = normalizeAddress(baseToken);
    const quoteAddress = normalizeAddress(quoteToken);
    if (!baseAddress || !quoteAddress || baseAddress === quoteAddress) {
      return null;
    }
    const tokens = [baseAddress, quoteAddress].sort();
    const [tokenA, tokenB] = tokens;
    const orientation = baseAddress === tokenA ? 'forward' : 'inverse';
    const key = `${tokenA}-${tokenB}`;
    return { key, tokenA, tokenB, orientation };
  }

  _ensurePairState(baseToken, quoteToken, fallbackPrice) {
    const descriptor = this._getCanonicalDescriptor(baseToken, quoteToken);
    if (!descriptor) {
      return null;
    }

    let state = this.pairStates.get(descriptor.key);
    if (!state) {
      let canonicalPrice = Number(fallbackPrice);
      if (!Number.isFinite(canonicalPrice) || canonicalPrice <= 0) {
        canonicalPrice = 1;
      }
      if (descriptor.orientation === 'inverse') {
        canonicalPrice = canonicalPrice > 0 ? 1 / canonicalPrice : 1;
      }
      if (!Number.isFinite(canonicalPrice) || canonicalPrice <= 0) {
        canonicalPrice = 1;
      }

      state = {
        tokenA: descriptor.tokenA,
        tokenB: descriptor.tokenB,
        price: canonicalPrice,
        baselinePrice: canonicalPrice,
        liquidityScore: this.defaultLiquidityScore,
        lastUpdatedAt: new Date(),
        lastSource: 'synthetic',
        lastSide: null,
      };
      this.pairStates.set(descriptor.key, state);
    }

    return { descriptor, state };
  }

  _getPriceFromState(state, descriptor) {
    if (!state) {
      return null;
    }
    if (!Number.isFinite(state.price) || state.price <= 0) {
      return null;
    }
    if (!descriptor || descriptor.orientation === 'forward') {
      return state.price;
    }
    return 1 / state.price;
  }

  _clampPrice(value) {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    if (value < this.minPrice) {
      return this.minPrice;
    }
    if (value > this.maxPrice) {
      return this.maxPrice;
    }
    return value;
  }

  _computeVolumeWeight(state, notionalVolume) {
    if (!Number.isFinite(notionalVolume) || notionalVolume <= 0) {
      return 0.05;
    }
    const baseLiquidity = Number.isFinite(state?.liquidityScore) && state.liquidityScore > 0
      ? state.liquidityScore
      : this.defaultLiquidityScore;
    const ratio = notionalVolume / (baseLiquidity + notionalVolume);
    const bounded = Math.min(0.85, Math.max(0.05, ratio));
    return bounded;
  }

  registerTrade(baseToken, quoteToken, trade = {}) {
    const baseAddress = normalizeAddress(baseToken);
    const quoteAddress = normalizeAddress(quoteToken);
    if (!baseAddress || !quoteAddress || baseAddress === quoteAddress) {
      return null;
    }

    const rawPrice = trade && trade.price !== undefined ? Number(trade.price) : null;
    const baseAmount = trade && trade.baseAmount !== undefined ? Number(trade.baseAmount) : Number(trade.amount);
    const quoteAmount = trade && trade.quoteAmount !== undefined ? Number(trade.quoteAmount) : null;

    let resolvedBaseAmount = Number.isFinite(baseAmount) && baseAmount > 0 ? baseAmount : null;
    let resolvedPrice = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
    let resolvedQuoteAmount = Number.isFinite(quoteAmount) && quoteAmount > 0 ? quoteAmount : null;

    if (!resolvedPrice && resolvedBaseAmount && resolvedQuoteAmount) {
      resolvedPrice = resolvedQuoteAmount / resolvedBaseAmount;
    } else if (!resolvedQuoteAmount && resolvedBaseAmount && resolvedPrice) {
      resolvedQuoteAmount = resolvedBaseAmount * resolvedPrice;
    }

    if (!resolvedPrice || !Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
      return null;
    }

    const stateInfo = this._ensurePairState(baseAddress, quoteAddress, resolvedPrice);
    if (!stateInfo) {
      return null;
    }

    const { descriptor, state } = stateInfo;
    const canonicalPrice = descriptor.orientation === 'forward' ? resolvedPrice : 1 / resolvedPrice;
    if (!Number.isFinite(canonicalPrice) || canonicalPrice <= 0) {
      return null;
    }

    const notionalVolume = resolvedQuoteAmount && resolvedQuoteAmount > 0
      ? resolvedQuoteAmount
      : resolvedBaseAmount && resolvedPrice
        ? resolvedBaseAmount * resolvedPrice
        : 0;

    const weight = this._computeVolumeWeight(state, notionalVolume);
    if (!Number.isFinite(state.price) || state.price <= 0) {
      state.price = canonicalPrice;
    } else {
      state.price = state.price + (canonicalPrice - state.price) * weight;
    }

    let directionalSign = 0;
    const side = trade && typeof trade.side === 'string' ? trade.side.toUpperCase() : null;
    if (side === 'SELL') {
      directionalSign = descriptor.orientation === 'forward' ? -1 : 1;
    } else if (side === 'BUY') {
      directionalSign = descriptor.orientation === 'forward' ? 1 : -1;
    }

    if (directionalSign !== 0) {
      const nudge = Math.min(0.25, weight * this.directionalImpactScale);
      const adjusted = state.price * (1 + directionalSign * nudge);
      const clamped = this._clampPrice(adjusted);
      if (clamped !== null) {
        state.price = clamped;
      }
    }

    const clampedPrice = this._clampPrice(state.price);
    if (clampedPrice !== null) {
      state.price = clampedPrice;
    } else {
      state.price = canonicalPrice;
    }

    const decay = this.liquidityDecay >= 0 && this.liquidityDecay < 1 ? this.liquidityDecay : 0.85;
    const currentLiquidity = Number.isFinite(state.liquidityScore) && state.liquidityScore > 0
      ? state.liquidityScore
      : this.defaultLiquidityScore;
    state.liquidityScore = currentLiquidity * decay + (Number.isFinite(notionalVolume) && notionalVolume > 0 ? notionalVolume : 0);
    state.lastUpdatedAt = new Date();
    state.lastSource = trade && trade.source ? trade.source : 'synthetic';
    state.lastSide = side || null;

    return this._getPriceFromState(state, descriptor);
  }

  recordMarketSnapshot(baseToken, quoteToken, price, metadata = {}) {
    const resolvedPrice = Number(price);
    if (!Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
      return null;
    }
    return this.registerTrade(baseToken, quoteToken, {
      price: resolvedPrice,
      baseAmount: metadata.baseAmount,
      quoteAmount: metadata.quoteAmount,
      side: metadata.side,
      source: metadata.source || 'market',
    });
  }

  async _getTokenMetadata(address, hint) {
    if (hint && typeof hint === 'object') {
      return hint;
    }
    const token = tokenService.getToken(address);
    if (token) {
      return token;
    }
    try {
      return await tokenService.ensureTokenMetadata(address);
    } catch (error) {
      return { address };
    }
  }

  async _getUnitValue(address, hint) {
    const normalized = normalizeAddress(address);
    if (!normalized) {
      return null;
    }
    if (this.unitValueCache.has(normalized)) {
      return this.unitValueCache.get(normalized);
    }
    const metadata = await this._getTokenMetadata(normalized, hint);
    const value = deriveUnitValue(metadata, normalized);
    this.unitValueCache.set(normalized, value);
    return value;
  }

  async getTokenUnitValue(address, hint) {
    return this._getUnitValue(address, hint);
  }

  async describePair(baseToken, quoteToken, context = {}) {
    if (!baseToken || !quoteToken) {
      return null;
    }

    const baseAddress = normalizeAddress(baseToken);
    const quoteAddress = normalizeAddress(quoteToken);
    if (!baseAddress || !quoteAddress) {
      return null;
    }

    const [baseMeta, quoteMeta] = await Promise.all([
      this._getTokenMetadata(baseAddress, context.baseTokenMeta),
      this._getTokenMetadata(quoteAddress, context.quoteTokenMeta),
    ]);

    const [baseValue, quoteValue] = await Promise.all([
      this._getUnitValue(baseAddress, baseMeta),
      this._getUnitValue(quoteAddress, quoteMeta),
    ]);

    if (!(baseValue > 0) || !(quoteValue > 0)) {
      return null;
    }

    const priceNumber = baseValue / quoteValue;
    if (!Number.isFinite(priceNumber) || !(priceNumber > 0)) {
      return null;
    }

    const stateInfo = this._ensurePairState(baseAddress, quoteAddress, priceNumber);
    const dynamicPrice = stateInfo ? this._getPriceFromState(stateInfo.state, stateInfo.descriptor) : null;
    const effectivePrice = Number.isFinite(dynamicPrice) && dynamicPrice > 0 ? dynamicPrice : priceNumber;
    const inversePriceNumber = effectivePrice > 0 ? 1 / effectivePrice : quoteValue / baseValue;
    const now = new Date();
    const source = stateInfo?.state?.lastSource || 'synthetic';
    const liquidityScore = stateInfo?.state?.liquidityScore ?? null;
    const baselinePrice = stateInfo?.state?.baselinePrice ?? priceNumber;
    const lastSide = stateInfo?.state?.lastSide || null;
    const lastUpdatedAt = stateInfo?.state?.lastUpdatedAt instanceof Date
      ? stateInfo.state.lastUpdatedAt.toISOString()
      : now.toISOString();

    return {
      baseToken: baseAddress,
      quoteToken: quoteAddress,
      price: formatPositiveNumber(effectivePrice),
      priceNumber: effectivePrice,
      inversePrice: formatPositiveNumber(inversePriceNumber),
      inversePriceNumber,
      baseUnitValue: baseValue,
      quoteUnitValue: quoteValue,
      base: {
        address: baseAddress,
        symbol: baseMeta?.symbol || null,
        name: baseMeta?.name || null,
        decimals: Number.isInteger(baseMeta?.decimals) ? Number(baseMeta.decimals) : null,
        totalSupply: baseMeta?.totalSupply ?? null,
      },
      quote: {
        address: quoteAddress,
        symbol: quoteMeta?.symbol || null,
        name: quoteMeta?.name || null,
        decimals: Number.isInteger(quoteMeta?.decimals) ? Number(quoteMeta.decimals) : null,
        totalSupply: quoteMeta?.totalSupply ?? null,
      },
      source,
      calculatedAt: now.toISOString(),
      dynamic: {
        liquidityScore,
        baselinePrice,
        lastSide,
        lastUpdatedAt,
      },
    };
  }

  async describeMatrix(tokenAddresses = []) {
    const addressList = Array.isArray(tokenAddresses) ? tokenAddresses : [];
    const normalized = Array.from(
      new Set(
        addressList
          .map((entry) => normalizeAddress(entry))
          .filter((entry) => entry && entry.length > 0)
      )
    );

    if (normalized.length === 0) {
      return {
        tokens: [],
        pairs: [],
        source: 'synthetic',
        generatedAt: new Date().toISOString(),
      };
    }

    const tokenEntries = await Promise.all(
      normalized.map(async (address) => {
        const metadata = await this._getTokenMetadata(address);
        const unitValue = await this._getUnitValue(address, metadata);
        return {
          address,
          metadata,
          unitValue,
        };
      })
    );

    const tokens = tokenEntries.map((entry) => ({
      address: entry.address,
      symbol: entry.metadata?.symbol || null,
      name: entry.metadata?.name || null,
      decimals: Number.isInteger(entry.metadata?.decimals) ? Number(entry.metadata.decimals) : null,
      unitValue: entry.unitValue,
      unitValueFormatted: formatPositiveNumber(entry.unitValue),
    }));

    const pairs = [];

    for (const baseEntry of tokenEntries) {
      for (const quoteEntry of tokenEntries) {
        const baseAddress = baseEntry.address;
        const quoteAddress = quoteEntry.address;
        let priceNumber = null;
        let inverseNumber = null;
        let stateInfo = null;
        if (baseAddress === quoteAddress) {
          priceNumber = 1;
          inverseNumber = 1;
        } else if (baseEntry.unitValue > 0 && quoteEntry.unitValue > 0) {
          const baseline = baseEntry.unitValue / quoteEntry.unitValue;
          stateInfo = this._ensurePairState(baseAddress, quoteAddress, baseline);
          const dynamic = stateInfo ? this._getPriceFromState(stateInfo.state, stateInfo.descriptor) : null;
          priceNumber = Number.isFinite(dynamic) && dynamic > 0 ? dynamic : baseline;
          inverseNumber = priceNumber > 0 ? 1 / priceNumber : quoteEntry.unitValue / baseEntry.unitValue;
        }

        pairs.push({
          baseToken: baseAddress,
          quoteToken: quoteAddress,
          baseSymbol: baseEntry.metadata?.symbol || null,
          quoteSymbol: quoteEntry.metadata?.symbol || null,
          priceNumber,
          price: priceNumber && priceNumber > 0 ? formatPositiveNumber(priceNumber) : null,
          inversePriceNumber: inverseNumber,
          inversePrice: inverseNumber && inverseNumber > 0 ? formatPositiveNumber(inverseNumber) : null,
          source: stateInfo?.state?.lastSource || 'synthetic',
        });
      }
    }

    return {
      tokens,
      pairs,
      source: 'synthetic',
      generatedAt: new Date().toISOString(),
    };
  }

  async estimatePairPrice(baseToken, quoteToken, context = {}) {
    const description = await this.describePair(baseToken, quoteToken, context);
    if (!description) {
      return null;
    }
    return description.priceNumber;
  }

  clearCache() {
    this.unitValueCache.clear();
    this.pairStates.clear();
  }
}

module.exports = new PriceOracleService();
