import React, { useEffect, useMemo, useState } from 'react';
import { issueToken, registerToken, fetchPriceMatrix } from '../services/api';

const initialFormState = {
  address: '',
  name: '',
  symbol: '',
  decimals: 18,
  description: '',
  issuer: '',
  totalSupply: '',
};

const issueFormInitial = {
  name: '',
  symbol: '',
  initialSupply: '',
  recipient: '',
};

const containerStyle = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
  marginBottom: '24px',
};

const listStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '20px',
  marginTop: '16px',
};

const cardStyle = {
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '18px',
  background: '#f8fafc',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  minWidth: 0,
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.06)',
};

const tokenTitleStyle = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 600,
  color: '#0f172a',
  lineHeight: 1.3,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
};

const tokenMetaRowStyle = {
  margin: 0,
  color: '#1e293b',
  fontSize: '13px',
  lineHeight: 1.5,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
};

const tokenMetaLabelStyle = {
  color: '#475569',
  fontWeight: 500,
};

const tableWrapperStyle = {
  overflowX: 'auto',
  marginTop: '12px',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: '360px',
};

const tableHeaderCellStyle = {
  padding: '8px 12px',
  border: '1px solid #e2e8f0',
  background: '#f1f5f9',
  fontWeight: 600,
  fontSize: '13px',
  textAlign: 'center',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
};

const tableCellStyle = {
  padding: '8px 12px',
  border: '1px solid #e2e8f0',
  fontSize: '13px',
  textAlign: 'center',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  marginBottom: '12px',
  fontSize: '14px',
  color: '#475569',
};

const inputStyle = {
  marginTop: '4px',
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
};

const buttonStyle = {
  marginTop: '12px',
  padding: '10px 16px',
  background: '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 600,
};

const tabButtonStyle = (isActive) => ({
  ...buttonStyle,
  background: isActive ? '#2563eb' : '#e2e8f0',
  color: isActive ? '#ffffff' : '#1f2937',
  marginRight: '12px',
});

const TokenManager = ({
  account,
  tokens,
  onTokensUpdated,
  onBalancesRefresh,
  isLoading,
  error,
}) => {
  const tokenList = Array.isArray(tokens) ? tokens : [];
  const [activeTab, setActiveTab] = useState('list');
  const [registerForm, setRegisterForm] = useState(initialFormState);
  const [issueForm, setIssueForm] = useState(() => ({ ...issueFormInitial, recipient: account || '' }));
  const [statusMessage, setStatusMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [priceMatrix, setPriceMatrix] = useState(null);
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [priceMatrixError, setPriceMatrixError] = useState('');

  useEffect(() => {
    if (!account) {
      return;
    }

    setIssueForm((previous) => {
      if (previous.recipient) {
        return previous;
      }

      return { ...previous, recipient: account };
    });
  }, [account]);

  useEffect(() => {
    if (activeTab !== 'list') {
      return;
    }
    if (tokenList.length === 0) {
      setPriceMatrix(null);
      setPriceMatrixError('');
      return;
    }

    let cancelled = false;
    const addresses = tokenList.map((token) => token.address);

    const load = async () => {
      setIsLoadingPrices(true);
      try {
        const data = await fetchPriceMatrix(addresses);
        if (!cancelled) {
          setPriceMatrix(data);
          setPriceMatrixError('');
        }
      } catch (error) {
        if (!cancelled) {
          setPriceMatrix(null);
          setPriceMatrixError(error.message || 'Failed to load price matrix');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPrices(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [activeTab, tokenList]);

  const priceMetaMap = useMemo(() => {
    const map = new Map();
    if (priceMatrix?.tokens) {
      priceMatrix.tokens.forEach((entry) => {
        if (!entry?.address) {
          return;
        }
        map.set(entry.address.toLowerCase(), entry);
      });
    }
    return map;
  }, [priceMatrix]);

  const matrixTokens = useMemo(() => {
    if (!tokenList.length) {
      return [];
    }
    return tokenList.map((token) => {
      const meta = token?.address ? priceMetaMap.get(token.address.toLowerCase()) : null;
      const label =
        token.symbol ||
        token.name ||
        (token.address ? `${token.address.slice(0, 6)}…${token.address.slice(-4)}` : 'Unknown token');
      return {
        ...token,
        displayLabel: label,
        syntheticUnitValue: meta?.unitValueFormatted || meta?.unitValue || null,
      };
    });
  }, [priceMetaMap, tokenList]);

  const priceLookup = useMemo(() => {
    const map = new Map();
    if (priceMatrix?.pairs) {
      priceMatrix.pairs.forEach((entry) => {
        if (!entry?.baseToken || !entry?.quoteToken) {
          return;
        }
        const key = `${entry.baseToken.toLowerCase()}-${entry.quoteToken.toLowerCase()}`;
        map.set(key, entry);
      });
    }
    return map;
  }, [priceMatrix]);

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatusMessage('');

    try {
      // Normalize the payload before sending it to the API
      const payload = {
        address: sanitizeAddress(registerForm.address),
        symbol: (registerForm.symbol || '').trim() || undefined,
        name: (registerForm.name || '').trim() || undefined,
        decimals: toNumberOrUndefined(registerForm.decimals) ?? 18,
        issuer: sanitizeAddress(registerForm.issuer) || undefined,
        totalSupply: toNumberOrUndefined(registerForm.totalSupply),
        description: (registerForm.description || '').trim() || undefined,
      };

      await registerToken(payload);
      setRegisterForm(initialFormState);
      setStatusMessage('Token registered. Please verify on-chain configuration.');
      if (onTokensUpdated) {
        await onTokensUpdated();
      }
      if (onBalancesRefresh) {
        onBalancesRefresh();
      }
    } catch (err) {
      setStatusMessage(err.message || 'Failed to register token');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleIssueSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatusMessage('');

    try {
      const payload = {
        ...issueForm,
        recipient: issueForm.recipient?.trim() || account || undefined,
      };
      await issueToken(payload);
      setIssueForm({ ...issueFormInitial, recipient: account || '' });
      setStatusMessage('Token issuance submitted. Confirm on-chain.');
      if (onTokensUpdated) {
        await onTokensUpdated();
      }
      if (onBalancesRefresh) {
        onBalancesRefresh();
      }
    } catch (err) {
      setStatusMessage(err.message || 'Failed to issue token');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', marginBottom: '16px' }}>
        <button
          type="button"
          style={tabButtonStyle(activeTab === 'list')}
          onClick={() => setActiveTab('list')}
        >
          Token List
        </button>
        <button
          type="button"
          style={tabButtonStyle(activeTab === 'register')}
          onClick={() => setActiveTab('register')}
        >
          Register Token
        </button>
        <button
          type="button"
          style={tabButtonStyle(activeTab === 'issue')}
          onClick={() => setActiveTab('issue')}
        >
          Issue On-Chain
        </button>
      </div>

      {statusMessage ? (
        <div style={{ marginBottom: '12px', color: '#2563eb' }}>{statusMessage}</div>
      ) : null}
      {error ? <div style={{ color: '#dc2626', marginBottom: '12px' }}>{error}</div> : null}

      {activeTab === 'list' ? (
        <div>
          {isLoading ? (
            <p>Loading…</p>
          ) : tokenList.length === 0 ? (
            <p>No tokens available. Register or issue one first.</p>
          ) : (
            <>
              <div style={listStyle}>
                {matrixTokens.map((token) => (
                  <div key={token.address} style={cardStyle}>
                    <h3 style={tokenTitleStyle}>{token.displayLabel || token.symbol || 'Unnamed token'}</h3>
                    <p style={tokenMetaRowStyle}>
                      <strong style={tokenMetaLabelStyle}>Address:</strong>{' '}
                      {token.address}
                    </p>
                    {token.name ? (
                      <p style={tokenMetaRowStyle}>
                        <strong style={tokenMetaLabelStyle}>Name:</strong>{' '}
                        {token.name}
                      </p>
                    ) : null}
                    {token.decimals !== null && token.decimals !== undefined ? (
                      <p style={tokenMetaRowStyle}>
                        <strong style={tokenMetaLabelStyle}>Decimals:</strong>{' '}
                        {token.decimals}
                      </p>
                    ) : null}
                    {token.totalSupply ? (
                      <p style={tokenMetaRowStyle}>
                        <strong style={tokenMetaLabelStyle}>Total Supply:</strong>{' '}
                        {token.totalSupply}
                      </p>
                    ) : null}
                    {token.issuer ? (
                      <p style={tokenMetaRowStyle}>
                        <strong style={tokenMetaLabelStyle}>Issuer:</strong>{' '}
                        {token.issuer}
                      </p>
                    ) : null}
                    {token.syntheticUnitValue ? (
                      <p style={tokenMetaRowStyle}>
                        <strong style={tokenMetaLabelStyle}>Synthetic Unit Value:</strong>{' '}
                        {token.syntheticUnitValue}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              {tokenList.length > 1 ? (
                <div style={{ marginTop: '24px' }}>
                  <h4 style={{ margin: '16px 0 4px' }}>Token Price Matrix (Synthetic)</h4>
                  <p style={{ margin: '0 0 8px', color: '#64748b', fontSize: '13px' }}>
                    Displays synthetic conversion rates between tokens to help estimate fills without live markets.
                  </p>
                  {isLoadingPrices ? (
                    <p>Loading prices…</p>
                  ) : priceMatrixError ? (
                    <p style={{ color: '#dc2626' }}>{priceMatrixError}</p>
                  ) : matrixTokens.length <= 1 ? (
                    <p>At least two tokens are required to build a price matrix.</p>
                  ) : (
                    <div style={tableWrapperStyle}>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={tableHeaderCellStyle}>Base \\ Quote</th>
                            {matrixTokens.map((quote) => (
                              <th key={`header-${quote.address}`} style={tableHeaderCellStyle}>
                                {quote.displayLabel}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {matrixTokens.map((base) => (
                            <tr key={`row-${base.address}`}>
                              <th style={{ ...tableHeaderCellStyle, background: '#e2e8f0' }}>{base.displayLabel}</th>
                              {matrixTokens.map((quote) => {
                                const baseAddress = base.address || '';
                                const quoteAddress = quote.address || '';
                                const lookupKey = `${baseAddress.toLowerCase()}-${quoteAddress.toLowerCase()}`;
                                const entry = baseAddress && quoteAddress ? priceLookup.get(lookupKey) : null;
                                let displayValue = '—';
                                if (baseAddress && baseAddress === quoteAddress) {
                                  displayValue = '1';
                                } else if (entry?.price) {
                                  displayValue = entry.price;
                                }
                                return (
                                  <td key={lookupKey} style={tableCellStyle}>
                                    {displayValue}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {activeTab === 'register' ? (
        <form onSubmit={handleRegisterSubmit}>
          <label style={labelStyle}>
            Token Address
            <input
              style={inputStyle}
              value={registerForm.address}
              onChange={(e) => setRegisterForm({ ...registerForm, address: e.target.value })}
              placeholder="0x..."
              required
            />
          </label>
          <label style={labelStyle}>
            Token Symbol
            <input
              style={inputStyle}
              value={registerForm.symbol}
              onChange={(event) => setRegisterForm({ ...registerForm, symbol: event.target.value })}
              placeholder="e.g. USDC"
            />
          </label>
          <label style={labelStyle}>
            Token Name
            <input
              style={inputStyle}
              value={registerForm.name}
              onChange={(event) => setRegisterForm({ ...registerForm, name: event.target.value })}
              placeholder="e.g. USD Coin"
            />
          </label>
          <label style={labelStyle}>
            Decimals
            <input
              style={inputStyle}
              type="number"
              value={registerForm.decimals}
              onChange={(e) => setRegisterForm({ ...registerForm, decimals: e.target.value })}
              placeholder="Default 18"
            />
          </label>
          <label style={labelStyle}>
            Issuer
            <input
              style={inputStyle}
              value={registerForm.issuer}
              onChange={(event) => setRegisterForm({ ...registerForm, issuer: event.target.value })}
              placeholder="Issuer address"
            />
          </label>
          <label style={labelStyle}>
            Total Supply
            <input
              style={inputStyle}
              value={registerForm.totalSupply}
              onChange={(event) => setRegisterForm({ ...registerForm, totalSupply: event.target.value })}
              placeholder="Optional"
            />
          </label>
          <label style={labelStyle}>
            Description
            <textarea
              style={{ ...inputStyle, minHeight: '80px' }}
              value={registerForm.description}
              onChange={(e) => setRegisterForm({ ...registerForm, description: e.target.value })}
            />
          </label>
          <button type="submit" style={buttonStyle} disabled={isSubmitting}>
            {isSubmitting ? 'Submitting…' : 'Register Token'}
          </button>
        </form>
      ) : null}

      {activeTab === 'issue' ? (
        <form onSubmit={handleIssueSubmit}>
          <label style={labelStyle}>
            Token Name
            <input
              style={inputStyle}
              value={issueForm.name}
              onChange={(e) => setIssueForm({ ...issueForm, name: e.target.value })}
              required
            />
          </label>
          <label style={labelStyle}>
            Token Symbol
            <input
              style={inputStyle}
              value={issueForm.symbol}
              onChange={(e) => setIssueForm({ ...issueForm, symbol: e.target.value })}
              required
            />
          </label>
          <label style={labelStyle}>
            Initial Supply
            <input
              style={inputStyle}
              type="number"
              value={issueForm.initialSupply}
              onChange={(event) => setIssueForm({ ...issueForm, initialSupply: event.target.value })}
              placeholder="e.g. 1000000"
            />
          </label>
          <label style={labelStyle}>
            Recipient (optional)
            <input
              style={inputStyle}
              value={issueForm.recipient}
              onChange={(event) => setIssueForm({ ...issueForm, recipient: event.target.value })}
              placeholder="Defaults to the deployer account"
            />
          </label>
          <button type="submit" style={buttonStyle} disabled={isSubmitting}>
            {isSubmitting ? 'Submitting…' : 'Issue Test Token'}
          </button>
        </form>
      ) : null}
    </div>
  );
};

export default TokenManager;
