import React, { useCallback, useEffect, useState } from 'react';
import { registerUser } from '../services/api';

const containerStyle = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
  marginBottom: '24px',
};

const buttonStyle = {
  padding: '10px 16px',
  background: '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  fontWeight: 600,
};

const infoStyle = {
  marginTop: '12px',
  fontSize: '14px',
  color: '#475569',
};

const WalletConnect = ({ onAccountChange, account, chainId }) => {
  const [status, setStatus] = useState('');

  const notifyAccountChange = useCallback(
    async (accounts, chain) => {
      const nextAccount = Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : null;
      if (onAccountChange) {
        onAccountChange(nextAccount, chain);
      }
      if (nextAccount) {
        try {
          await registerUser({ address: nextAccount });
        } catch (error) {
          setStatus(error.message || 'Unable to register user');
        }
      }
    },
    [onAccountChange],
  );

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setStatus('No Ethereum wallet detected. Please install MetaMask.');
      return;
    }
    try {
      const [accounts, chain] = await Promise.all([
        window.ethereum.request({ method: 'eth_requestAccounts' }),
        window.ethereum.request({ method: 'eth_chainId' }),
      ]);
      setStatus('');
      await notifyAccountChange(accounts, chain);
    } catch (error) {
      setStatus(error.message || 'Failed to connect wallet');
    }
  }, [notifyAccountChange]);

  useEffect(() => {
    if (!window.ethereum) {
      setStatus('Ethereum wallet environment not detected');
      return undefined;
    }

    const handleAccountsChanged = (accounts) => {
      notifyAccountChange(accounts, chainId);
    };

    const handleChainChanged = (nextChainId) => {
      if (onAccountChange) {
        onAccountChange(account, nextChainId);
      }
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((accounts) => {
        if (accounts && accounts.length > 0) {
          return window.ethereum.request({ method: 'eth_chainId' }).then((chain) => {
            notifyAccountChange(accounts, chain);
          });
        }
        return null;
      })
      .catch(() => {});

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [account, chainId, notifyAccountChange, onAccountChange]);

  return (
    <div className="wallet-connect" style={containerStyle}>
      <h2 style={{ marginTop: 0 }}>Wallet Connection</h2>
      <button type="button" style={buttonStyle} onClick={connectWallet}>
        {account ? 'Switch Wallet' : 'Connect Wallet'}
      </button>
      {status ? <div style={{ ...infoStyle, color: '#dc2626' }}>{status}</div> : null}
      {account ? (
        <div style={infoStyle}>
          <div>Address: {account}</div>
          <div>Network: {chainId || 'Unknown'}</div>
        </div>
      ) : (
        <div style={infoStyle}>No wallet connected</div>
      )}
    </div>
  );
};

export default WalletConnect;
