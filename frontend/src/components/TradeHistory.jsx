import React, { useEffect, useMemo, useState } from 'react';
import { fetchRecentTrades } from '../services/api';

const POLL_INTERVAL_MS = 5000;

const styles = {
  container: {
    background: '#ffffff',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  form: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'flex-end',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    fontSize: '14px',
    color: '#334155',
  },
  input: {
    marginTop: '4px',
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #cbd5f5',
    minWidth: '140px',
  },
  button: {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  statusBar: {
    display: 'flex',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '8px',
    fontSize: '14px',
    color: '#475569',
  },
  error: {
    color: '#dc2626',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '16px',
  },
  tableWrapper: {
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    overflow: 'hidden',
    background: '#f8fafc',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    background: '#e2e8f0',
    color: '#1f2937',
    fontWeight: 600,
  },
  td: {
    padding: '10px 12px',
    borderTop: '1px solid #e2e8f0',
  },
  empty: {
    textAlign: 'center',
    padding: '24px 0',
    color: '#94a3b8',
  },
};

function formatNumber(value, fractionDigits = 4) {
  if (value === null || value === undefined) {
    return '-';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

function formatTimestamp(value) {
  if (!value) {
    return '-';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleTimeString();
}

const TradeTable = ({ title, trades }) => (
  <div className="trade-table" style={styles.tableWrapper}>
    <h3 style={{ margin: '0', padding: '12px', background: '#e2e8f0', color: '#0f172a' }}>{title}</h3>
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Price</th>
          <th style={styles.th}>Amount</th>
          <th style={styles.th}>Timestamp</th>
        </tr>
      </thead>
      <tbody>
        {trades.length === 0 ? (
          <tr>
            <td colSpan={3} style={styles.empty} className="empty">
              No data
            </td>
          </tr>
        ) : (
          trades.map((trade) => (
            <tr key={`${trade.timestamp}-${trade.takerOrderId}-${trade.makerOrderId}`}>
              <td style={styles.td}>{formatNumber(trade.price)}</td>
              <td style={styles.td}>{formatNumber(trade.amount)}</td>
              <td style={styles.td}>{formatTimestamp(trade.timestamp)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

const TradeHistory = ({ baseToken, quoteToken, onPairChange }) => {
  const [localBase, setLocalBase] = useState(baseToken || '');
  const [localQuote, setLocalQuote] = useState(quoteToken || '');
  const [trades, setTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    setLocalBase(baseToken || '');
  }, [baseToken]);

  useEffect(() => {
    setLocalQuote(quoteToken || '');
  }, [quoteToken]);

  useEffect(() => {
    let isMounted = true;
    let timerId;

    const loadTrades = async () => {
      if (!baseToken || !quoteToken) {
        return;
      }
      setIsLoading(true);
      try {
        const data = await fetchRecentTrades({ baseToken, quoteToken, limit: 25 });
        if (isMounted) {
          setTrades(data);
          setLastUpdated(new Date());
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Failed to load trade data');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadTrades();
    timerId = setInterval(loadTrades, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      if (timerId) {
        clearInterval(timerId);
      }
    };
  }, [baseToken, quoteToken]);

  const groupedTrades = useMemo(() => {
    const buyTrades = [];
    const sellTrades = [];
    trades.forEach((trade) => {
      if (!trade) {
        return;
      }
      if (trade.takerOrderId && trade.takerOrderId === trade.buyOrderId) {
        buyTrades.push(trade);
      } else if (trade.takerOrderId && trade.takerOrderId === trade.sellOrderId) {
        sellTrades.push(trade);
      } else {
        buyTrades.push(trade);
      }
    });
    return {
      buy: buyTrades.reverse(),
      sell: sellTrades.reverse(),
    };
  }, [trades]);

  return (
    <div className="trade-history" style={styles.container}>
      <h2 style={{ margin: 0 }}>Recent Trades</h2>
      <form
        className="pair-form"
        style={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (onPairChange) {
            onPairChange(localBase.trim(), localQuote.trim());
          }
        }}
      >
        <label style={styles.label}>
          Base Token
          <input
            name="baseToken"
            value={localBase}
            onChange={(event) => setLocalBase(event.target.value)}
            placeholder="e.g. ETH"
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Quote Token
          <input
            name="quoteToken"
            value={localQuote}
            onChange={(event) => setLocalQuote(event.target.value)}
            placeholder="e.g. USDC"
            style={styles.input}
          />
        </label>
        <button type="submit" style={styles.button}>
          Update Pair
        </button>
      </form>
      <div className="status-bar" style={styles.statusBar}>
        {isLoading ? (
          <span>Loading…</span>
        ) : (
          <span>Last updated: {formatTimestamp(lastUpdated)}</span>
        )}
        {error ? (
          <span className="error" style={styles.error}>
            {error}
          </span>
        ) : null}
      </div>
      <div className="trade-columns" style={styles.columns}>
        <TradeTable title="Buys" trades={groupedTrades.buy} />
        <TradeTable title="Sells" trades={groupedTrades.sell} />
      </div>
    </div>
  );
};

export default TradeHistory;
