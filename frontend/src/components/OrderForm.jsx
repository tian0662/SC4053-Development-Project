import React, { useEffect, useMemo, useState } from 'react';
import { prepareOrder, submitOrder } from '../services/api';

const containerStyle = {
  background: '#ffffff',
  borderRadius: '12px',
  padding: '24px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.08)',
  marginBottom: '24px',
  flex: 1,
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
  border: '1px solid #cbd5f5',
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

const orderTypes = [
  { value: 'LIMIT', label: 'Limit' },
  { value: 'MARKET', label: 'Market' },
  { value: 'STOP_LOSS', label: 'Stop' },
  { value: 'STOP_LIMIT', label: 'Stop Limit' },
];

const timeInForceOptions = [
  { value: 'GTC', label: 'GTC - Good till cancelled' },
  { value: 'IOC', label: 'IOC - Immediate or cancel' },
  { value: 'FOK', label: 'FOK - Fill or kill' },
  { value: 'POST_ONLY', label: 'POST_ONLY - Maker only' },
];

const OrderForm = ({
  account,
  tokens,
  baseToken,
  quoteToken,
  onPairChange,
  onOrderCreated,
  onActivity,
}) => {
  const [side, setSide] = useState('BUY');
  const [orderType, setOrderType] = useState('LIMIT');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [timeInForce, setTimeInForce] = useState('GTC');
  const [allowPartialFill, setAllowPartialFill] = useState(true);
  const [maxSlippage, setMaxSlippage] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectableTokens = useMemo(() => tokens || [], [tokens]);

  const availableTimeInForce = useMemo(() => {
    if (orderType === 'MARKET') {
      return timeInForceOptions.filter((option) => ['GTC', 'IOC', 'FOK'].includes(option.value));
    }
    if (orderType === 'STOP_LOSS') {
      return timeInForceOptions.filter((option) => option.value === 'GTC' || option.value === 'FOK');
    }
    if (orderType === 'STOP_LIMIT') {
      return timeInForceOptions.filter((option) => option.value === 'GTC' || option.value === 'FOK');
    }
    return timeInForceOptions;
  }, [orderType]);

  useEffect(() => {
    if (orderType === 'MARKET') {
      if (!['GTC', 'IOC', 'FOK'].includes(timeInForce)) {
        setTimeInForce('GTC');
      }
      if (!allowPartialFill) {
        setAllowPartialFill(true);
      }
      if (price) {
        setPrice('');
      }
    }

    if (orderType === 'STOP_LOSS') {
      if (!['GTC', 'FOK'].includes(timeInForce)) {
        setTimeInForce('GTC');
      }
    }

    if (orderType === 'STOP_LIMIT' || orderType === 'LIMIT') {
      if (timeInForce === 'IOC') {
        setTimeInForce('GTC');
      }
    }

    if (orderType !== 'MARKET' && maxSlippage) {
      setMaxSlippage('');
    }

    if (orderType !== 'STOP_LOSS' && orderType !== 'STOP_LIMIT' && stopPrice) {
      setStopPrice('');
    }
    if (availableTimeInForce.length > 0 && !availableTimeInForce.some((option) => option.value === timeInForce)) {
      setTimeInForce(availableTimeInForce[0].value);
    }
  }, [
    allowPartialFill,
    availableTimeInForce,
    maxSlippage,
    orderType,
    price,
    stopPrice,
    timeInForce,
  ]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!account) {
      setStatus('Please connect your wallet first');
      return;
    }
    if (!baseToken || !quoteToken) {
      setStatus('Select a trading pair');
      return;
    }
    setIsSubmitting(true);
    setStatus('');
    try {
      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('Wallet extension not detected');
      }

      const orderInput = {
        trader: account,
        baseToken,
        quoteToken,
        side,
        orderType,
        timeInForce,
        allowPartialFill,
        price: price || null,
        amount: amount || null,
        stopPrice: stopPrice || null,
        maxSlippage: orderType === 'MARKET' ? maxSlippage || null : null,
      };

      setStatus('Preparing order data…');
      onActivity?.({
        title: 'Preparing order',
        message: `${side} ${orderType} order is being prepared, amount ${amount || '-'}.`,
        variant: 'info',
      });
      const prepared = await prepareOrder(orderInput);
      if (!prepared?.typedData) {
        throw new Error('Backend did not return signing payload');
      }

      const typedData = prepared.typedData;
      const serializedData = JSON.stringify(typedData);

      setStatus('Waiting for wallet signature…');
      onActivity?.({
        title: 'Awaiting signature',
        message: `Please sign the ${side} ${orderType} order in your wallet.`,
        variant: 'info',
      });
      let signature;
      const signMethods = [
        { method: 'eth_signTypedData_v4', params: [account, serializedData] },
        { method: 'eth_signTypedData', params: [account, typedData] },
        { method: 'eth_signTypedData_v3', params: [account, serializedData] },
      ];

      let lastError = null;
      for (const request of signMethods) {
        try {
          signature = await window.ethereum.request(request);
          if (signature) {
            break;
          }
        } catch (error) {
          lastError = error;
          if (error?.code === 4001) {
            throw new Error('User rejected the signature request');
          }
        }
      }

      if (!signature) {
        if (lastError) {
          throw new Error(lastError.message || 'Wallet did not return a signature');
        }
        throw new Error('Wallet did not return a signature');
      }

      setStatus('Submitting order…');
      onActivity?.({
        title: 'Submitting order',
        message: `Submitting ${side} ${orderType} order, amount ${amount || '-'}.`,
        variant: 'info',
      });
      const submissionPayload = {
        ...orderInput,
        signature,
        onchain: prepared.onchain,
        metadata: prepared.metadata,
      };

      if (prepared?.onchain?.nonce !== undefined) {
        submissionPayload.nonce = prepared.onchain.nonce;
      }

      if (prepared?.typedData?.domain?.chainId !== undefined) {
        submissionPayload.chainId = prepared.typedData.domain.chainId;
      }

      if (prepared?.typedData?.domain?.verifyingContract) {
        submissionPayload.verifyingContract = prepared.typedData.domain.verifyingContract;
      }

      if (prepared?.hash) {
        submissionPayload.orderHash = prepared.hash;
      }

      await submitOrder(submissionPayload);
      setStatus('Order created and queued for matching');
      onActivity?.({
        title: 'Order submitted',
        message: `${side} ${orderType} order has been sent for matching.`,
        variant: 'success',
      });
      setPrice('');
      setAmount('');
      setStopPrice('');
      setMaxSlippage('');
      if (onOrderCreated) {
        await onOrderCreated();
      }
    } catch (error) {
      setStatus(error.message || 'Failed to create order');
      onActivity?.({
        title: 'Order submission failed',
        message: error.message || 'Failed to create order',
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="order-form" style={containerStyle}>
      <h2 style={{ marginTop: 0 }}>Create Order</h2>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {orderTypes.map((type) => (
          <button
            key={type.value}
            type="button"
            style={{
              ...buttonStyle,
              padding: '8px 14px',
              background: orderType === type.value ? '#2563eb' : '#e2e8f0',
              color: orderType === type.value ? '#ffffff' : '#1f2937',
            }}
            onClick={() => setOrderType(type.value)}
          >
            {type.label}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <label style={labelStyle}>
          Base Token
          <select
            style={inputStyle}
            value={baseToken || ''}
            onChange={(event) =>
              onPairChange?.(event.target.value, event.target.value === quoteToken ? '' : quoteToken)
            }
          >
            <option value="">Select token</option>
            {selectableTokens.map((token) => (
              <option key={token.address} value={token.address}>
                {token.symbol || token.address}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Quote Token
          <select
            style={inputStyle}
            value={quoteToken || ''}
            onChange={(event) =>
              onPairChange?.(baseToken, event.target.value === baseToken ? '' : event.target.value)
            }
          >
            <option value="">Select token</option>
            {selectableTokens
              .filter((token) => token.address !== baseToken)
              .map((token) => (
                <option key={token.address} value={token.address}>
                  {token.symbol || token.address}
                </option>
              ))}
          </select>
        </label>
        <label style={labelStyle}>
          Side
          <select
            style={inputStyle}
            value={side}
            onChange={(event) => setSide(event.target.value.toUpperCase())}
          >
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </select>
        </label>
        {orderType !== 'MARKET' ? (
          <label style={labelStyle}>
            Price
            <input
              style={inputStyle}
              type="number"
              step="any"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder={orderType === 'STOP_LIMIT' ? 'Limit price after trigger' : 'e.g. 2500'}
              required={orderType === 'LIMIT' || orderType === 'STOP_LIMIT'}
            />
          </label>
        ) : null}
        {(orderType === 'STOP_LOSS' || orderType === 'STOP_LIMIT') ? (
          <label style={labelStyle}>
            Trigger Price
            <input
              style={inputStyle}
              type="number"
              step="any"
              value={stopPrice}
              onChange={(event) => setStopPrice(event.target.value)}
              placeholder="Order triggers at this price"
              required
            />
          </label>
        ) : null}
        {orderType === 'MARKET' ? (
          <label style={labelStyle}>
            Max Slippage (bp)
            <input
              style={inputStyle}
              type="number"
              step="any"
              value={maxSlippage}
              onChange={(event) => setMaxSlippage(event.target.value)}
              placeholder="e.g. 50 means 0.5%"
            />
          </label>
        ) : null}
        <label style={labelStyle}>
          Amount
          <input
            style={inputStyle}
            type="number"
            step="any"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="e.g. 10"
            required
          />
        </label>
        <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
          <span>Allow partial fills</span>
          <input
            type="checkbox"
            checked={allowPartialFill}
            onChange={(event) => setAllowPartialFill(event.target.checked)}
            disabled={orderType === 'MARKET' || orderType === 'STOP_LOSS'}
          />
        </label>
        <label style={labelStyle}>
          Time in Force
          <select
            style={inputStyle}
            value={timeInForce}
            onChange={(event) => setTimeInForce(event.target.value)}
          >
            {availableTimeInForce.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={buttonStyle} disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Submit Order'}
        </button>
      </form>
      
    </div>
  );
};

export default OrderForm;
