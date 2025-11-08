const API_BASE_URL = (() => {
  const explicitEnvUrl =
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
    (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_BASE_URL) ||
    (typeof process !== 'undefined' && process.env && process.env.API_BASE_URL);

  if (explicitEnvUrl) {
    return explicitEnvUrl.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    const preferredPort = port && port !== '' && port !== '5173' ? port : '4000';
    const portSuffix = preferredPort ? `:${preferredPort}` : '';
    return `${protocol}//${hostname}${portSuffix}`;
  }

  return 'http://localhost:4000';
})();

async function request(path, options = {}) {
  const base = API_BASE_URL || '';
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${suffix}`;
  const { headers, ...rest } = options;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
    ...rest,
  });

  if (!response.ok) {
    const errorPayload = await response
      .json()
      .catch(() => ({ message: response.statusText || 'Request failed' }));
    const error = new Error(errorPayload?.message || 'Request failed');
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

export async function fetchRecentTrades({ baseToken, quoteToken, limit = 20 } = {}) {
  if (!baseToken || !quoteToken) {
    return [];
  }
  const params = new URLSearchParams({ baseToken, quoteToken });
  if (limit) {
    params.set('limit', String(limit));
  }
  const trades = await request(`/api/orders/trades?${params.toString()}`);
  return Array.isArray(trades) ? trades : [];
}

export async function fetchTokens() {
  const tokens = await request('/api/tokens');
  return Array.isArray(tokens) ? tokens : [];
}

export async function registerToken(payload) {
  return request('/api/tokens', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function issueToken(payload) {
  return request('/api/tokens/issue', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchOrderBook({ baseToken, quoteToken }) {
  if (!baseToken || !quoteToken) {
    return { buy: [], sell: [], stopLoss: [], stopLimit: [], trades: [] };
  }
  const params = new URLSearchParams({ baseToken, quoteToken });
  return request(`/api/orders/book?${params.toString()}`);
}

export async function fetchPairPrice(baseToken, quoteToken) {
  if (!baseToken || !quoteToken) {
    return null;
  }
  const params = new URLSearchParams({ baseToken, quoteToken });
  return request(`/api/prices/pair?${params.toString()}`);
}

export async function fetchPriceMatrix(tokens = []) {
  const list = Array.isArray(tokens) ? tokens.filter((entry) => entry) : [];
  const params = new URLSearchParams();
  if (list.length > 0) {
    params.set('tokens', list.join(','));
  }
  const suffix = params.toString();
  const path = suffix ? `/api/prices/matrix?${suffix}` : '/api/prices/matrix';
  return request(path);
}

export async function prepareOrder(payload) {
  return request('/api/orders/prepare', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function submitOrder(payload) {
  return request('/api/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getOrder(id) {
  if (!id) {
    throw new Error('Order id is required');
  }
  return request(`/api/orders/${encodeURIComponent(id)}`);
}

export async function listOrders(filters = {}) {
  const params = new URLSearchParams();
  if (filters.baseToken) {
    params.set('baseToken', filters.baseToken);
  }
  if (filters.quoteToken) {
    params.set('quoteToken', filters.quoteToken);
  }
  if (filters.trader) {
    params.set('trader', filters.trader);
  }
  if (filters.status) {
    params.set('status', filters.status);
  }
  const suffix = params.toString();
  const path = suffix ? `/api/orders?${suffix}` : '/api/orders';
  const orders = await request(path);
  return Array.isArray(orders) ? orders : [];
}

export async function cancelOrder(id, reason) {
  if (!id) {
    throw new Error('Order id is required');
  }
  return request(`/api/orders/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function updateMarketPrice(payload) {
  return request('/api/orders/market-price', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function registerUser(payload) {
  return request('/api/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchBalances(address, { tokens = [], includeWallet = false } = {}) {
  if (!address) {
    return { address: '', balances: [] };
  }
  const params = new URLSearchParams();
  if (tokens.length > 0) {
    params.set('tokens', tokens.join(','));
  }
  if (includeWallet) {
    params.set('includeWallet', 'true');
  }
  return request(`/api/users/${address}/balances?${params.toString()}`);
}

export async function fetchDexConfig() {
  return request('/api/dex/config');
}

export async function fetchDexNonce(address) {
  if (!address) {
    throw new Error('address is required');
  }
  return request(`/api/dex/nonce/${encodeURIComponent(address)}`);
}

export async function fetchDexBalances(address) {
  if (!address) {
    throw new Error('address is required');
  }
  return request(`/api/dex/balances/${encodeURIComponent(address)}`);
}

export async function depositDex(payload) {
  return request('/api/dex/deposit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function withdrawDex(payload) {
  return request('/api/dex/withdraw', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function executeOrder(payload) {
  return request('/api/dex/execute', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function executeMarketOrder(payload) {
  return request('/api/dex/execute-market', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function cancelOrderOnChain(payload) {
  return request('/api/dex/cancel', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function cancelOrdersBatch(payload) {
  return request('/api/dex/cancel-batch', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function incrementDexNonce(payload = {}) {
  return request('/api/dex/nonce/increment', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export default {
  fetchRecentTrades,
  fetchTokens,
  registerToken,
  issueToken,
  fetchOrderBook,
  prepareOrder,
  submitOrder,
  getOrder,
  listOrders,
  cancelOrder,
  updateMarketPrice,
  registerUser,
  fetchBalances,
  fetchDexConfig,
  fetchDexNonce,
  fetchDexBalances,
  depositDex,
  withdrawDex,
  executeOrder,
  executeMarketOrder,
  cancelOrderOnChain,
  cancelOrdersBatch,
  incrementDexNonce,
};
