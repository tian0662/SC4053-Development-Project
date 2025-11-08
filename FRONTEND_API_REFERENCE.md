# Frontend API Reference

This document summarizes the backend endpoints exposed for the trading frontend. All paths are relative to the API server root.

## Orders (`/api/orders`)

### `POST /api/orders/prepare`
Builds canonical on-chain fields and EIP-712 typed data for a draft order so the frontend can present the payload for wallet signing.

**Body fields**
- `trader` *(string, required)*: maker address.
- `baseToken`, `quoteToken` *(string, required)*: ERC-20 token addresses for the trading pair.
- `side` *("BUY" | "SELL", required)*.
- `price` *(string|number, required unless `onchain.amountGet` & `onchain.amountGive` supplied)*: quote per base.
- `amount` *(string|number, required)*: base token amount.
- `orderType`, `timeInForce`, `allowPartialFill`, `stopPrice`, `minFillAmount`, `expiry`, `nonce` *(optional)*.
- `onchain` *(object, optional)*: overrides for precomputed fields (e.g., `amountGet`, `amountGive`, `tokenGet`, `tokenGive`, `nonce`, etc.).

**Response fields**
- `onchain`: sanitized order struct (numeric fields serialized as strings, enums as indices) ready for contract calls.
- `typedData`: `{ domain, types, primaryType, message }` for EIP-712 signing (message values already stringified).
- `hash`: EIP-712 order digest (`0x…`).
- `metadata`: decimals, formatted amounts, and price context for UI display.
- Additional convenience fields: `side`, `orderType`, `timeInForce`, `amount`, `price`, `nonce`, `expiry`, `allowPartialFill`, etc.

### `POST /api/orders`
Creates and enqueues a signed order for matching.

**Body fields**
Same as `/prepare`, plus:
- `signature` *(string, required)*: wallet signature of the prepared typed data (`0x`-prefixed hex string).

Backend verifies the signature against the maker, stores sanitized metadata, and immediately attempts to match/settle trades.

### `GET /api/orders`
Query stored orders. Optional query params: `baseToken`, `quoteToken`, `trader`, `status`.

### `GET /api/orders/book`
Return current order book for a pair (`baseToken`, `quoteToken`). Without query params, returns snapshot for all pairs.

### `GET /api/orders/trades`
Recent trades for a pair. Required query params: `baseToken`, `quoteToken`. Optional `limit` (default 50).

### `POST /api/orders/batch`
Execute cyclical batch trades by order IDs. Body: `{ orderIds: string[], tolerance?: number }`.

### `POST /api/orders/market-price`
Update off-chain market price reference for a pair. Body: `{ baseToken, quoteToken, price }`.

### `GET /api/orders/:id`
Fetch single order (includes metadata, on-chain struct, execution history).

### `POST /api/orders/:id/cancel`
Cancel an order locally (also stops further matching). Body may include `{ reason?: string }`.

## DEX Operations (`/api/dex`)

### `GET /api/dex/config`
Return deployed DEX address, network info, confirmation target, and whether backend signer is configured.

### `GET /api/dex/nonce/:address`
Fetch on-chain nonce for a maker address.

### `GET /api/dex/balances/:address`
Return DEX custody balances for all registered tokens. Each item includes `token`, `balance`, and optional error details.

### `POST /api/dex/deposit`
Body: `{ token, amount, privateKey?, autoApprove? }`. Deposits tokens into the exchange (optionally approves ERC20 first when `autoApprove=true`).

### `POST /api/dex/withdraw`
Body: `{ token, amount, privateKey? }`. Withdraw tokens from the exchange contract.

### `POST /api/dex/execute`
Execute a signed limit order. Body: `{ order, signature, fillAmount, privateKey?, overrides? }`.

### `POST /api/dex/execute-market`
Execute a signed market order with optional slippage guard. Body: `{ order, signature, maxSlippage, privateKey? }` (slippage in basis points).

### `POST /api/dex/cancel`
Cancel a single on-chain order. Body: `{ order, privateKey? }`.

### `POST /api/dex/cancel-batch`
Cancel multiple orders. Body: `{ orders: Order[], privateKey? }`.

### `POST /api/dex/nonce/increment`
Force-increment maker nonce to invalidate older orders. Body: `{ privateKey? }`.

## Tokens (`/api/tokens`)

### `GET /api/tokens`
List registered tokens (address, symbol, decimals, metadata).

### `GET /api/tokens/:address`
Fetch & cache ERC-20 metadata for a specific token address.

### `POST /api/tokens`
Register an existing token manually. Body may include `{ address, symbol, name, decimals, issuer, totalSupply, description }`.

### `POST /api/tokens/issue`
Deploy a new mock ERC-20 via backend signer. Body: `{ name, symbol, initialSupply?, recipient?, artifactPath? }`.

## Users (`/api/users`)

### `GET /api/users`
List registered users.

### `POST /api/users`
Register a user profile. Body: `{ address, alias?, metadata? }` (see service for exact schema).

### `GET /api/users/:address`
Fetch stored user profile.

### `GET /api/users/:address/balances`
Query DEX (and optional wallet) balances for a user. Query params: `tokens` (comma-separated list) and `includeWallet=true` to fetch wallet balances alongside exchange balances.

