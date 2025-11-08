# Frontend ↔ Backend API Integration Plan

This document summarizes the frontend service wrappers required to cover the full order lifecycle. It explains how the UI should call each helper to support balance preparation, order creation, monitoring, and on-chain settlement.

## 1. Conventions

- **Base request helper:** `frontend/src/services/api.js` exposes `request`, which automatically prefixes `REACT_APP_API_BASE_URL` and sends JSON for all POST requests. Responses with a 204 status or an empty body resolve to `null`.
- **Error handling:** Each wrapper throws an `Error` on non-2xx responses. The thrown object includes `error.status` so the UI can differentiate between retryable failures and validation issues.

## 2. Order Lifecycle APIs

| Step | Helper | Description |
| --- | --- | --- |
| List / detail | `listOrders(filters)` / `getOrder(id)` | Supports filters such as `baseToken`, `quoteToken`, `trader`, and `status`. Detail calls return the latest state of a single order. |
| Prepare signature | `prepareOrder(orderInput)` | Converts form data into the on-chain schema and returns `typedData`, `onchain`, and `metadata` payloads. |
| Wallet signature | Use `window.ethereum.request({ method: 'eth_signTypedData_v4', … })`; fall back to `eth_signTypedData` or `eth_signTypedData_v3` when necessary. |
| Submit order | `submitOrder({ ...orderInput, signature })` | Requires the same core fields that were passed to `prepareOrder`, plus the collected signature. |
| Cancel order | `cancelOrder(id, reason?)` | Off-chain cancellation that syncs the matching engine. |
| Update reference price | `updateMarketPrice({ baseToken, quoteToken, price })` | Maintains stop/market trigger data points. |

### Form Integration Example

`OrderForm.jsx` demonstrates the end-to-end flow:

1. Collect form fields (`baseToken`, `quoteToken`, `side`, `amount`, `price`, etc.).
2. Call `prepareOrder` to obtain typed data.
3. Ask the wallet to sign and pass the signature to `submitOrder` alongside the form payload.
4. Reset UI state (clear form, refresh list) when the request succeeds.

## 3. User & Asset Management APIs

| Feature | Helper | Description |
| --- | --- | --- |
| Register user | `registerUser(payload)` | Adds a new participant to the matching engine. |
| Fetch balances | `fetchBalances(address, { tokens, includeWallet })` | Returns both DEX escrow balances and optional wallet balances. |
| Token management | `fetchTokens()` / `registerToken(payload)` / `issueToken(payload)` | List, register, and issue supported assets. |

## 4. On-Chain DEX Operations

| Scenario | Helper | Notes |
| --- | --- | --- |
| DEX configuration | `fetchDexConfig()` | Retrieves network, contract addresses, and backend signer metadata. |
| Nonce management | `fetchDexNonce(address)` / `incrementDexNonce({ privateKey? })` | Keeps takers or bots in sync with the on-chain nonce. |
| Escrow balances | `fetchDexBalances(address)` | Returns balances for all supported tokens. |
| Deposit / withdraw | `depositDex({ token, amount, privateKey?, autoApprove })` / `withdrawDex({ token, amount, privateKey? })` | `amount` should be provided in base units (number or string). `autoApprove` triggers an approval before deposits. |
| Match execution | `executeOrder({ order, signature, fillAmount, privateKey?, overrides })` | Executes a fill for a specific quantity. |
| Market execution | `executeMarketOrder({ order, signature, maxSlippage, privateKey? })` | Supports a max slippage constraint. |
| On-chain cancellation | `cancelOrderOnChain({ order, privateKey? })` / `cancelOrdersBatch({ orders, privateKey? })` | Cancels orders that already exist on-chain. |

Before invoking on-chain helpers, prompt the user for a private key (or instruct them to rely on the backend signer) and validate inputs such as `amount` and `maxSlippage`.

## 5. Combined Workflows

- **Funding → Order Placement**
  1. Call `depositDex` to escrow funds.
  2. Use the form to `prepareOrder` → sign → `submitOrder`.

- **Order Monitoring → Manual Settlement**
  1. Poll `listOrders({ trader })` or subscribe via WebSocket.
  2. When an order is ready, call `executeOrder` to settle it.

- **Stop-Loss Maintenance**
  1. Periodically compute reference prices from market data.
  2. Push updates with `updateMarketPrice` to drive triggers.

## 6. Error and Retry Strategy

- Every API error includes `error.status` and `error.message`. Display validation guidance for 4xx responses and enable retries for 5xx.
- Wallet signing errors with `code === 4001` indicate that the user rejected the request—surface a friendly prompt to retry.
- On-chain operations require confirmations; use the returned `receipt` object to show transaction hashes and status indicators in the UI.

Following these integration patterns lets the frontend cover the complete cycle: funding → order signing and submission → monitoring → settlement/cancellation → fund recovery.

