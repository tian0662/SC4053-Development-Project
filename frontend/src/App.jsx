import React, { useCallback, useEffect, useMemo, useState } from 'react';
import WalletConnect from './components/WalletConnect';
import OrderForm from './components/OrderForm';
import OrderBook from './components/OrderBook';
import TradeHistory from './components/TradeHistory';
import Balance from './components/Balance';
import TokenManager from './components/TokenManager';
import OrdersPanel from './components/OrdersPanel';
import ActivityFeed from './components/ActivityFeed';
import { fetchTokens, listOrders, cancelOrder, fetchPairPrice } from './services/api';

const App = () => {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [selectedPair, setSelectedPair] = useState({ baseToken: '', quoteToken: '' });
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState(null);
  const [activities, setActivities] = useState([]);
  const [balanceRefreshNonce, setBalanceRefreshNonce] = useState(0);
  const [pairPrice, setPairPrice] = useState(null);
  const [isLoadingPairPrice, setIsLoadingPairPrice] = useState(false);
  const [pairPriceError, setPairPriceError] = useState(null);

  const refreshTokens = useCallback(async () => {
    setIsLoadingTokens(true);
    try {
      const tokenList = await fetchTokens();
      setTokens(tokenList);
      setTokenError(null);
      if (tokenList.length >= 2 && (!selectedPair.baseToken || !selectedPair.quoteToken)) {
        setSelectedPair({ baseToken: tokenList[0].address, quoteToken: tokenList[1].address });
      }
    } catch (error) {
      setTokenError(error.message || 'Failed to load token list');
    } finally {
      setIsLoadingTokens(false);
    }
  }, [selectedPair.baseToken, selectedPair.quoteToken]);

  useEffect(() => {
    refreshTokens();
  }, [refreshTokens]);

  const handleAccountChange = useCallback((nextAccount, nextChainId) => {
    setAccount(nextAccount);
    setChainId(nextChainId);
  }, []);

  const triggerBalanceRefresh = useCallback(() => {
    setBalanceRefreshNonce((prev) => prev + 1);
  }, []);

  const appendActivity = useCallback(({ title, message, variant = 'info' }) => {
    setActivities((prev) => {
      const now = new Date();
      const entry = {
        id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        title: title || 'Status update',
        message: message || '',
        variant,
        timestamp: now.toLocaleTimeString(),
      };
      return [entry, ...prev].slice(0, 25);
    });
  }, []);

  const refreshPairPrice = useCallback(async () => {
    if (!selectedPair.baseToken || !selectedPair.quoteToken) {
      setPairPrice(null);
      setPairPriceError(null);
      return;
    }
    setIsLoadingPairPrice(true);
    try {
      const data = await fetchPairPrice(selectedPair.baseToken, selectedPair.quoteToken);
      setPairPrice(data);
      setPairPriceError(null);
    } catch (error) {
      setPairPrice(null);
      setPairPriceError(error.message || 'Failed to fetch price');
    } finally {
      setIsLoadingPairPrice(false);
    }
  }, [selectedPair.baseToken, selectedPair.quoteToken, tokens]);

  const refreshOrders = useCallback(async () => {
    if (!account) {
      setOrders([]);
      return;
    }
    setIsLoadingOrders(true);
    try {
      const data = await listOrders({ trader: account });
      setOrders(Array.isArray(data) ? data : []);
      setOrdersError(null);
    } catch (error) {
      setOrdersError(error.message || 'Failed to load orders');
    } finally {
      setIsLoadingOrders(false);
    }
  }, [account]);

  const handlePairChange = useCallback((baseToken, quoteToken) => {
    setSelectedPair({ baseToken, quoteToken });
  }, []);

  useEffect(() => {
    if (account) {
      refreshOrders();
    } else {
      setOrders([]);
    }
  }, [account, refreshOrders]);

  useEffect(() => {
    if (account && (selectedPair.baseToken || selectedPair.quoteToken)) {
      refreshOrders();
    }
  }, [account, selectedPair.baseToken, selectedPair.quoteToken, refreshOrders]);

  useEffect(() => {
    refreshPairPrice();
  }, [refreshPairPrice]);

  const handleOrderCreated = useCallback(async () => {
    await refreshTokens();
    await refreshOrders();
    await refreshPairPrice();
    triggerBalanceRefresh();
  }, [refreshOrders, refreshTokens, refreshPairPrice, triggerBalanceRefresh]);

  const resolveToken = useCallback(
    (address) => tokens.find((token) => token.address === address) || null,
    [tokens],
  );

  const selectedBase = useMemo(() => resolveToken(selectedPair.baseToken), [resolveToken, selectedPair.baseToken]);
  const selectedQuote = useMemo(() => resolveToken(selectedPair.quoteToken), [resolveToken, selectedPair.quoteToken]);

  const selectedBaseLabel = useMemo(() => {
    if (!selectedBase) {
      return '';
    }
    if (selectedBase.symbol) {
      return selectedBase.symbol;
    }
    if (selectedBase.name) {
      return selectedBase.name;
    }
    return selectedBase.address ? `${selectedBase.address.slice(0, 6)}…${selectedBase.address.slice(-4)}` : '';
  }, [selectedBase]);

  const selectedQuoteLabel = useMemo(() => {
    if (!selectedQuote) {
      return '';
    }
    if (selectedQuote.symbol) {
      return selectedQuote.symbol;
    }
    if (selectedQuote.name) {
      return selectedQuote.name;
    }
    return selectedQuote.address ? `${selectedQuote.address.slice(0, 6)}…${selectedQuote.address.slice(-4)}` : '';
  }, [selectedQuote]);

  const selectedPairLabel = useMemo(() => {
    if (selectedBase && selectedQuote) {
      return `${selectedBase.symbol || selectedBase.address} / ${selectedQuote.symbol || selectedQuote.address}`;
    }
    return 'No trading pair selected';
  }, [selectedBase, selectedQuote]);

  const handleCancelOrder = useCallback(
    async (order) => {
      if (!order?.id) {
        throw new Error('Missing order ID');
      }
      try {
        await cancelOrder(order.id);
        const baseLabel =
          order.baseSymbol || order.baseTokenSymbol || order.baseToken || selectedBase?.symbol || selectedBase?.address || '';
        const quoteLabel =
          order.quoteSymbol || order.quoteTokenSymbol || order.quoteToken || selectedQuote?.symbol || selectedQuote?.address || '';
        const pairLabel = baseLabel && quoteLabel ? `${baseLabel}/${quoteLabel}` : baseLabel || quoteLabel || 'Unspecified pair';
        appendActivity({
          title: 'Cancel request submitted',
          message: `${order.side ?? ''} ${order.orderType ?? ''} ${pairLabel} (#${
            typeof order.id === 'string' ? order.id.slice(0, 6) : order.id
          }) cancellation requested.`,
          variant: 'warning',
        });
        await refreshOrders();
      } catch (error) {
        appendActivity({
          title: 'Cancel failed',
          message: error.message || 'Failed to cancel order',
          variant: 'error',
        });
        throw error;
      }
    },
    [appendActivity, refreshOrders, selectedBase, selectedQuote],
  );



  return (
    <div className="app">
      <header>
        <h1>Off-Chain Order Book DEX</h1>
        <p className="subtitle">All-in-one off-chain order book interface with advanced order types and live tracking.</p>
        <div className="pair-summary">
          <div className="pair-label">{selectedPairLabel}</div>
          <div className="pair-meta">
            <span>
              Available tokens:
              {tokens.length}
            </span>
            {selectedBase?.decimals !== undefined ? <span>Base decimals: {selectedBase.decimals}</span> : null}
            {selectedQuote?.decimals !== undefined ? <span>Quote decimals: {selectedQuote.decimals}</span> : null}
            {selectedBase && selectedQuote ? (
              <span>
                Synthetic price:
                {isLoadingPairPrice
                  ? 'Loading…'
                  : pairPrice?.price
                  ? `1 ${selectedBaseLabel || selectedBase.address} ≈ ${pairPrice.price} ${selectedQuoteLabel || selectedQuote.address}`
                  : pairPriceError
                  ? 'Failed to load'
                  : 'No data'}
                {pairPrice?.source
                  ? ` (${pairPrice.source.toLowerCase().startsWith('synthetic') ? 'synthetic' : pairPrice.source})`
                  : null}
              </span>
            ) : null}
            {selectedBase && selectedQuote && pairPrice?.inversePrice ? (
              <span>
                Inverse price: 1 {selectedQuoteLabel || selectedQuote.address} ≈ {pairPrice.inversePrice}{' '}
                {selectedBaseLabel || selectedBase.address}
              </span>
            ) : null}
            {pairPrice?.dynamic?.lastSide ? (
              <span>
                Last trade side: {pairPrice.dynamic.lastSide === 'BUY' ? 'Buy' : 'Sell'} (updated{' '}
                {pairPrice.dynamic.lastUpdatedAt ? new Date(pairPrice.dynamic.lastUpdatedAt).toLocaleTimeString() : 'just now'})
              </span>
            ) : null}
            {typeof pairPrice?.dynamic?.liquidityScore === 'number' ? (
              <span>Virtual liquidity: {pairPrice.dynamic.liquidityScore.toFixed(2)}</span>
            ) : null}
            {pairPriceError && !isLoadingPairPrice ? (
              <span style={{ color: '#dc2626' }}>Price error: {pairPriceError}</span>
            ) : null}
          </div>
        </div>
      </header>
      <main>
        <section className="top-banner">
          <WalletConnect onAccountChange={handleAccountChange} account={account} chainId={chainId} />
        </section>
        <div className="dashboard-grid">
          <div className="primary-column">
            <OrderForm
              account={account}
              tokens={tokens}
              baseToken={selectedPair.baseToken}
              quoteToken={selectedPair.quoteToken}
              onPairChange={handlePairChange}
              onOrderCreated={handleOrderCreated}
              onActivity={appendActivity}
            />
            <OrdersPanel
              account={account}
              baseToken={selectedPair.baseToken}
              quoteToken={selectedPair.quoteToken}
              orders={orders}
              isLoading={isLoadingOrders}
              error={ordersError}
              onRefresh={refreshOrders}
              onCancelOrder={handleCancelOrder}
            />
            <ActivityFeed entries={activities} />
          </div>
          <div className="secondary-column">
            <TokenManager
              account={account}
              tokens={tokens}
              onTokensUpdated={refreshTokens}
              onBalancesRefresh={triggerBalanceRefresh}
              isLoading={isLoadingTokens}
              error={tokenError}
            />
            <Balance
              account={account}
              tokens={tokens}
              isLoadingTokens={isLoadingTokens}
              tokenError={tokenError}
              refreshSignal={balanceRefreshNonce}
            />
            <OrderBook
              tokens={tokens}
              baseToken={selectedPair.baseToken}
              quoteToken={selectedPair.quoteToken}
              onPairChange={handlePairChange}
            />
            <TradeHistory
              baseToken={selectedPair.baseToken}
              quoteToken={selectedPair.quoteToken}
              onPairChange={handlePairChange}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
