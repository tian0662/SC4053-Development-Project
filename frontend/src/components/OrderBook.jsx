import React, { useEffect, useState } from 'react';
import { fetchOrderBook } from '../services/api';

const containerStyle = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
  marginBottom: '24px',
  flex: 1,
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
};

const headerCellStyle = {
  borderBottom: '1px solid #e2e8f0',
  padding: '12px',
  textAlign: 'left',
  color: '#0f172a',
};

const cellStyle = {
  padding: '10px 12px',
  borderBottom: '1px solid #f1f5f9',
};

const selectStyle = {
  marginLeft: '12px',
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid #cbd5f5',
};

const OrderBook = ({ tokens, baseToken, quoteToken, onPairChange }) => {
  const tokenList = Array.isArray(tokens) ? tokens : [];
  const [book, setBook] = useState({ buy: [], sell: [], stopLoss: [], stopLimit: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!baseToken || !quoteToken) {
      setBook({ buy: [], sell: [], stopLoss: [], stopLimit: [] });
      return;
    }

    let isMounted = true;
    const loadBook = async () => {
      setIsLoading(true);
      try {
        const data = await fetchOrderBook({ baseToken, quoteToken });
        if (isMounted) {
          setBook(data);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Failed to load order book');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadBook();
    return () => {
      isMounted = false;
    };
  }, [baseToken, quoteToken]);

  const renderRows = (orders, variant = 'limit') => {
    if (!orders || orders.length === 0) {
      return (
        <tr>
          <td style={cellStyle} colSpan={variant === 'stop' ? 4 : 3}>
            No data
          </td>
        </tr>
      );
    }
    return orders.map((order) => (
      <tr key={order.id}>
        {variant === 'stop' ? (
          <>
            <td style={cellStyle}>{order.stopPrice ?? '-'}</td>
            <td style={cellStyle}>{order.price ?? order.limitPrice ?? '-'}</td>
          </>
        ) : (
          <td style={cellStyle}>{order.price ?? '-'}</td>
        )}
        <td style={cellStyle}>{order.amount}</td>
        <td style={cellStyle}>{order.trader}</td>
      </tr>
    ));
  };

  return (
    <div className="order-book" style={containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Order Book</h2>
        <select
          style={selectStyle}
          value={baseToken || ''}
          onChange={(event) => onPairChange?.(event.target.value, quoteToken)}
        >
          <option value="">Base token</option>
          {tokenList.map((token) => (
            <option key={token.address} value={token.address}>
              {token.symbol || token.address}
            </option>
          ))}
        </select>
        <select
          style={selectStyle}
          value={quoteToken || ''}
          onChange={(event) => onPairChange?.(baseToken, event.target.value)}
        >
          <option value="">Quote token</option>
          {tokenList
            .filter((token) => token.address !== baseToken)
            .map((token) => (
              <option key={token.address} value={token.address}>
                {token.symbol || token.address}
              </option>
            ))}
        </select>
      </div>
      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      {isLoading ? <p>Loading…</p> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        <div>
          <h3>Buys</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={headerCellStyle}>Price</th>
                <th style={headerCellStyle}>Amount</th>
                <th style={headerCellStyle}>Trader</th>
              </tr>
            </thead>
            <tbody>{renderRows(book.buy)}</tbody>
          </table>
        </div>
        <div>
          <h3>Sells</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={headerCellStyle}>Price</th>
                <th style={headerCellStyle}>Amount</th>
                <th style={headerCellStyle}>Trader</th>
              </tr>
            </thead>
            <tbody>{renderRows(book.sell)}</tbody>
          </table>
        </div>
        <div>
          <h3>Stop Orders</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={headerCellStyle}>Trigger</th>
                <th style={headerCellStyle}>Execution Price</th>
                <th style={headerCellStyle}>Amount</th>
                <th style={headerCellStyle}>Trader</th>
              </tr>
            </thead>
            <tbody>{renderRows(book.stopLoss, 'stop')}</tbody>
          </table>
        </div>
        <div>
          <h3>Stop Limit Orders</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={headerCellStyle}>Trigger</th>
                <th style={headerCellStyle}>Limit Price</th>
                <th style={headerCellStyle}>Amount</th>
                <th style={headerCellStyle}>Trader</th>
              </tr>
            </thead>
            <tbody>{renderRows(book.stopLimit, 'stop')}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OrderBook;
