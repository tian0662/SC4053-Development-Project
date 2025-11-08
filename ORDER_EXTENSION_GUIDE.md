# 📈 Comprehensive Order Extension Guide

## Table of Contents
1. [Base Order Structure](#base-order-structure)
2. [Extended Order Structure](#extended-order-structure)
3. [Order Types](#order-types)
4. [Time-in-Force Options](#time-in-force-options)
5. [Implementation Examples](#implementation-examples)
6. [Frontend Integration](#frontend-integration)
7. [Backend Processing](#backend-processing)

---

## Base Order Structure

The minimal order payload used by the legacy contract:

```solidity
struct Order {
    address maker;
    address tokenGet;
    uint256 amountGet;
    address tokenGive;
    uint256 amountGive;
    uint256 nonce;
    uint256 expiry;
}
```

**Best suited for:** a basic DEX that only needs limit orders.

---

## Extended Order Structure

### Full Extended Version

```solidity
struct Order {
    // Core fields
    address maker;
    address tokenGet;
    uint256 amountGet;
    address tokenGive;
    uint256 amountGive;
    uint256 nonce;
    uint256 expiry;

    // Order classification
    OrderType orderType;
    TimeInForce timeInForce;
    OrderSide side;

    // Price and conditional controls
    uint256 stopPrice;
    uint256 minFillAmount;
    bool allowPartialFill;

    // Fees
    address feeRecipient;
    uint256 feeAmount;
}
```

### Enumerations

```solidity
enum OrderType {
    LIMIT,
    MARKET,
    STOP_LOSS,
    STOP_LIMIT
}

enum TimeInForce {
    GTC,        // Good-Till-Cancelled
    IOC,        // Immediate-Or-Cancel
    FOK,        // Fill-Or-Kill
    POST_ONLY   // Maker-only
}

enum OrderSide {
    BUY,
    SELL
}

enum OrderStatus {
    PENDING,
    PARTIAL,
    FILLED,
    CANCELLED,
    EXPIRED,
    REJECTED
}
```

---

## Order Types

### 1. Limit Orders 📊
**Definition:** Execute at the specified price or better.  
**Traits:** Deterministic price, may rest on the book, most common order type.

```javascript
const limitOrder = {
  maker: userAddress,
  tokenGet: USDTAddress,
  amountGet: ethers.parseEther('100'), // Wants 100 USDT
  tokenGive: ETHAddress,
  amountGive: ethers.parseEther('0.05'), // Will spend 0.05 ETH
  orderType: OrderType.LIMIT,
  timeInForce: TimeInForce.GTC,
  side: OrderSide.SELL,
  allowPartialFill: true,
};
// Price = 100 USDT / 0.05 ETH = 2,000 USDT per ETH
```

### 2. Market Orders 🚀
**Definition:** Fill immediately against available liquidity.  
**Traits:** Guaranteed execution, price uncertainty and potential slippage.

```javascript
const marketOrder = {
  ...baseFields,
  orderType: OrderType.MARKET,
  timeInForce: TimeInForce.IOC,
  maxSlippageBps: 150, // Optional frontend-side control
};
```

### 3. Stop Loss Orders 🛑
**Definition:** Trigger a market-style execution once price crosses the stop.  
**Traits:** Protective order for downside risk.

```javascript
const stopLoss = {
  ...baseFields,
  orderType: OrderType.STOP_LOSS,
  stopPrice: ethers.parseEther('1800'),
  allowPartialFill: true,
};
```

### 4. Stop Limit Orders ⚖️
**Definition:** Becomes a limit order when the stop price is reached.  
**Traits:** Gives control over both trigger and execution price.

```javascript
const stopLimit = {
  ...baseFields,
  orderType: OrderType.STOP_LIMIT,
  stopPrice: ethers.parseEther('1850'),
  limitPrice: ethers.parseEther('1845'),
  allowPartialFill: false,
};
```

---

## Time-in-Force Options

| Option | Meaning | Recommended Usage |
| ------ | ------- | ----------------- |
| `GTC` | Good-Till-Cancelled | Default for resting orders and manual cancellation |
| `IOC` | Immediate-Or-Cancel | Market orders where partial fills are acceptable |
| `FOK` | Fill-Or-Kill | Full size must execute immediately or the order is void |
| `POST_ONLY` | Maker-only | Ensures the order adds liquidity and never crosses |

Additional flags:
- `allowPartialFill` – if `false`, combine with `FOK` semantics.
- `minFillAmount` – ensures the execution meets a minimum threshold before accepting the fill.

---

## Implementation Examples

### Backend Pseudocode for Adding a Limit Order
```javascript
async function addLimitOrder(order) {
  validateSignature(order);
  const balance = await checkBalance(order.maker, order.tokenGive);
  if (balance < order.amountGive) {
    throw new Error('Insufficient balance');
  }
  await db.orders.insert({
    ...order,
    status: 'PENDING',
    createdAt: Date.now(),
  });
  await matchingEngine.tryMatch(order);
}
```

### Matching Considerations
- Sort bids and asks independently by price and time.
- Enforce `minFillAmount` and `allowPartialFill` during execution.
- Update status to `PARTIAL` or `FILLED` as fills occur.
- Emit events for downstream processors (websocket updates, analytics, etc.).

---

## Frontend Integration

1. Collect user input (amounts, side, order type, stop price, etc.).
2. Call `prepareOrder` to receive typed data and on-chain payloads.
3. Request a wallet signature via `eth_signTypedData_v4`.
4. Submit the signed order using `submitOrder`.
5. Refresh local state (order list, balances) after submission.

UI tips:
- Hide irrelevant fields based on order type.
- Display validation errors from the API.
- Provide contextual help for stop prices, slippage, and partial fills.

---

## Backend Processing

1. **Input validation** – schema validation, numeric range checks, order type compatibility.
2. **Signature verification** – recover signer and compare with `order.maker`.
3. **Nonce management** – fetch on-chain nonce and ensure `order.nonce` is current.
4. **Balance checks** – verify maker balances on the DEX contract when relevant.
5. **Persistence** – store order metadata, status, and signature.
6. **Matching loop** – attempt immediate matches for IOC/FOK; enqueue limit orders for later.
7. **Event propagation** – notify websocket clients or worker queues when an order changes state.

By following this guide, you can extend the base DEX order format into a feature-rich structure that supports advanced trading workflows while remaining compatible with the existing smart contract.

