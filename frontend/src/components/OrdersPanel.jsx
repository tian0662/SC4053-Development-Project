import React, { useMemo, useState } from 'react';

function normalizeAddress(value) {
  if (!value) {
    return '';
  }
  return String(value).toLowerCase();
}

const containerStyle = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const filterButtonStyle = (isActive) => ({
  padding: '8px 14px',
  borderRadius: '999px',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  background: isActive ? '#2563eb' : '#e2e8f0',
  color: isActive ? '#ffffff' : '#334155',
});

const badgeStyle = (variant = 'default') => {
  const variants = {
    OPEN: { background: 'rgba(37, 99, 235, 0.14)', color: '#1d4ed8' },
    PARTIALLY_FILLED: { background: 'rgba(14, 165, 233, 0.16)', color: '#0369a1' },
    FILLED: { background: 'rgba(34, 197, 94, 0.14)', color: '#047857' },
    CANCELLED: { background: 'rgba(148, 163, 184, 0.24)', color: '#475569' },
    EXPIRED: { background: 'rgba(249, 115, 22, 0.18)', color: '#c2410c' },
    REJECTED: { background: 'rgba(220, 38, 38, 0.14)', color: '#b91c1c' },
    default: { background: 'rgba(15, 23, 42, 0.1)', color: '#0f172a' },
  };
  return {
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: '999px',
    padding: '4px 10px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    ...(variants[variant] || variants.default),
  };
};

const orderCardStyle = {
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  background: '#f8fafc',
};

const rowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px 18px',
  fontSize: '14px',
  color: '#1f2937',
};

const labelStyle = {
  fontSize: '12px',
  color: '#64748b',
};

const actionBarStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const cancelButtonStyle = {
  background: '#ef4444',
  color: '#ffffff',
  border: 'none',
  borderRadius: '6px',
  padding: '8px 12px',
  cursor: 'pointer',
  fontWeight: 600,
};

const refreshButtonStyle = {
  background: 'transparent',
  color: '#2563eb',
  border: '1px solid #2563eb',
  borderRadius: '6px',
  padding: '8px 12px',
  cursor: 'pointer',
  fontWeight: 600,
};

const FILTERS = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Open' },
  { value: 'FILLED', label: 'Filled' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function normalizeStatus(status) {
  if (!status) {
    return 'UNKNOWN';
  }
  return String(status).toUpperCase();
}

function isActiveStatus(status) {
  const normalized = normalizeStatus(status);
  return !['FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(normalized);
}

const OrdersPanel = ({
  account,
  baseToken,
  quoteToken,
  orders = [],
  isLoading,
  error,
  onRefresh,
  onCancelOrder,
}) => {
  const [filter, setFilter] = useState('ACTIVE');
  const [cancelError, setCancelError] = useState('');

  const hasAnyOrders = Array.isArray(orders) && orders.length > 0;

  const pairFilteredOrders = useMemo(() => {
    if (!Array.isArray(orders)) {
      return [];
    }
    const normalizedBase = normalizeAddress(baseToken);
    const normalizedQuote = normalizeAddress(quoteToken);
    if (!normalizedBase && !normalizedQuote) {
      return orders;
    }
    return orders.filter((order) => {
      const orderBase = normalizeAddress(order?.baseToken);
      const orderQuote = normalizeAddress(order?.quoteToken);
      if (normalizedBase && orderBase !== normalizedBase) {
        return false;
      }
      if (normalizedQuote && orderQuote !== normalizedQuote) {
        return false;
      }
      return true;
    });
  }, [orders, baseToken, quoteToken]);

  const hasOrdersForPair = pairFilteredOrders.length > 0;

  const filteredOrders = useMemo(() => {
    if (!Array.isArray(pairFilteredOrders)) {
      return [];
    }
    if (filter === 'ALL') {
      return pairFilteredOrders;
    }
    if (filter === 'ACTIVE') {
      return pairFilteredOrders.filter((order) => isActiveStatus(order.status));
    }
    return pairFilteredOrders.filter((order) => normalizeStatus(order.status) === filter);
  }, [filter, pairFilteredOrders]);

  const cancelDisabledStatuses = ['FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED'];

  const renderAmount = (order) => {
    if (!order) {
      return '-';
    }
    const filled = order.filledAmount ?? order.executedAmount ?? 0;
    const total = order.amount ?? order.baseAmount ?? order.originalAmount ?? '-';
    if (!total || Number(total) === 0) {
      return filled ? `${filled}` : '-';
    }
    return `${filled} / ${total}`;
  };

  const renderPair = (order) => {
    if (!order) {
      return '-';
    }
    const base = order.baseSymbol || order.baseTokenSymbol || order.baseToken || '';
    const quote = order.quoteSymbol || order.quoteTokenSymbol || order.quoteToken || '';
    if (!base || !quote) {
      return base || quote || '-';
    }
    return `${base} / ${quote}`;
  };

  const handleCancel = async (order) => {
    if (!onCancelOrder || !order?.id) {
      return;
    }
    setCancelError('');
    try {
      await onCancelOrder(order);
    } catch (err) {
      setCancelError(err?.message || 'Failed to cancel order');
    }
  };

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={actionBarStyle}>
          <div>
            <h2 style={{ margin: 0 }}>Order Status</h2>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {baseToken && quoteToken ? `Current pair: ${baseToken} / ${quoteToken}` : 'Select a trading pair'}
            </div>
          </div>
          <button type="button" style={refreshButtonStyle} onClick={onRefresh} disabled={isLoading}>
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              style={filterButtonStyle(filter === item.value)}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {!account ? <div style={{ color: '#94a3b8' }}>Connect a wallet to view your orders.</div> : null}
      {error ? <div style={{ color: '#dc2626' }}>{error}</div> : null}
      {cancelError ? <div style={{ color: '#dc2626' }}>{cancelError}</div> : null}
      {isLoading ? <div style={{ color: '#64748b' }}>Loading orders…</div> : null}

      {account && !isLoading && !hasOrdersForPair && hasAnyOrders ? (
        <div style={{ color: '#94a3b8' }}>
          No orders for this trading pair. Switch the pair to view your other orders.
        </div>
      ) : null}
      {account && !isLoading && hasOrdersForPair && filteredOrders.length === 0 ? (
        <div style={{ color: '#94a3b8' }}>No orders match the selected filter.</div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {filteredOrders.map((order) => {
          const status = normalizeStatus(order.status);
          const canCancel = !cancelDisabledStatuses.includes(status);
          const syntheticFill = order.metadata?.syntheticFill;
          const formattedSyntheticQuote = (() => {
            if (!syntheticFill || syntheticFill.quoteAmount === undefined || syntheticFill.quoteAmount === null) {
              return null;
            }
            const numeric = Number(syntheticFill.quoteAmount);
            if (Number.isFinite(numeric)) {
              return numeric.toLocaleString();
            }
            return syntheticFill.quoteAmount;
          })();
          const quoteDisplay =
            order.quoteSymbol ||
            order.quoteTokenSymbol ||
            order.metadata?.quoteToken ||
            order.quoteToken ||
            '';
          return (
            <div key={order.id} style={orderCardStyle}>
              <div style={actionBarStyle}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
                    {order.side} {order.orderType} · {renderPair(order)}
                  </div>
                  <div style={labelStyle}>Order ID: {order.id}</div>
                </div>
                <span style={badgeStyle(status)}>{status}</span>
              </div>
              <div style={rowStyle}>
                <div>
                  <div style={labelStyle}>Order Price</div>
                  <div>{order.price ?? order.limitPrice ?? (order.orderType === 'MARKET' ? 'Market' : '-')}</div>
                </div>
                <div>
                  <div style={labelStyle}>Filled / Total</div>
                  <div>{renderAmount(order)}</div>
                </div>
                <div>
                  <div style={labelStyle}>Time in Force</div>
                  <div>{order.timeInForce || 'GTC'}</div>
                </div>
                <div>
                  <div style={labelStyle}>Price Source</div>
                  <div>{order.metadata?.priceSource ? String(order.metadata.priceSource).toUpperCase() : '-'}</div>
                </div>
                {order.stopPrice ? (
                  <div>
                    <div style={labelStyle}>Trigger Price</div>
                    <div>{order.stopPrice}</div>
                  </div>
                ) : null}
              </div>
              {syntheticFill ? (
                <div
                  style={{
                    marginTop: '8px',
                    background: 'rgba(59, 130, 246, 0.12)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '12px',
                    color: '#1d4ed8',
                  }}
                >
                  Filled via synthetic liquidity at {syntheticFill.price}{' '}
                  {quoteDisplay}
                  {formattedSyntheticQuote ? `, approx. quote volume ${formattedSyntheticQuote}` : ''}
                  .
                </div>
              ) : null}
              {canCancel ? (
                <div style={actionBarStyle}>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    Last update: {order.updatedAt ? new Date(order.updatedAt).toLocaleString() : 'Unknown'}
                  </span>
                  <button type="button" style={cancelButtonStyle} onClick={() => handleCancel(order)}>
                    Cancel Order
                  </button>
                </div>
              ) : (
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Completed at: {order.updatedAt ? new Date(order.updatedAt).toLocaleString() : 'Unknown'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrdersPanel;

