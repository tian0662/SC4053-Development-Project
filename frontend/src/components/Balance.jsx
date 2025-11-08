import React, { useEffect, useState } from 'react';
import { fetchBalances } from '../services/api';

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

const Balance = ({ account, tokens, isLoadingTokens, tokenError, refreshSignal = 0 }) => {
  const [balances, setBalances] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!account || !tokens || tokens.length === 0) {
      setBalances([]);
      return;
    }

    let isMounted = true;
    const loadBalances = async () => {
      setIsLoading(true);
      try {
        const response = await fetchBalances(account, {
          tokens: tokens.map((token) => token.address),
          includeWallet: true,
        });
        if (isMounted) {
          setBalances(response.balances || []);
          setError(null);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Failed to load balances');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadBalances();
    return () => {
      isMounted = false;
    };
  }, [account, tokens, refreshSignal]);

  return (
    <div className="balance" style={containerStyle}>
      <h2 style={{ marginTop: 0 }}>Account Balances</h2>
      {!account ? <p>Please connect your wallet first</p> : null}
      {tokenError ? <p style={{ color: '#dc2626' }}>{tokenError}</p> : null}
      {isLoadingTokens ? <p>Loading tokens…</p> : null}
      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      {isLoading ? <p>Fetching balances…</p> : null}
      {account && balances.length > 0 ? (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={headerCellStyle}>Token</th>
              <th style={headerCellStyle}>DEX Balance</th>
              <th style={headerCellStyle}>Wallet Balance</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((entry) => (
              <tr key={entry.token.address}>
                <td style={cellStyle}>{entry.token.symbol || entry.token.address}</td>
                <td style={cellStyle}>{entry.dexBalance}</td>
                <td style={cellStyle}>{entry.walletBalance ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {account && !isLoading && balances.length === 0 ? <p>No balance data available</p> : null}
    </div>
  );
};

export default Balance;
