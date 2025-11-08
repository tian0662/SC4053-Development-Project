# 📊 Order Type Reference

## Quick Comparison

| Order Type | Price Control | Speed | Slippage Risk | Typical Use Case | Fees |
|------------|---------------|-------|---------------|------------------|------|
| **LIMIT** | Fixed | Medium | None | Precise entry/exit prices | Maker fee (lower) |
| **MARKET** | Floating | Immediate | High | Fast execution | Taker fee (higher) |
| **STOP_LOSS** | Market after trigger | Conditional | High | Risk management | Taker fee |
| **STOP_LIMIT** | Fixed after trigger | Conditional | None | Precise stop execution | Maker fee |

---

## Order Lifecycle Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         Create Order                        │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
        ┌───────────────┐
        │ Choose Type   │
        └───┬───┬───┬───┘
            │   │   │
    ┌───────┘   │   └───────┐
    │           │           │
    ▼           ▼           ▼
┌───────┐  ┌───────┐  ┌──────────┐
│ LIMIT │  │ MARKET│  │ STOP_LOSS│
└───┬───┘  └───┬───┘  └────┬─────┘
    │          │           │
    │          │           ▼
    │          │      ┌─────────┐
    │          │      │ Monitor │
    │          │      └────┬────┘
    │          │           │
    │          │           ▼
    │          │      ┌─────────┐
    │          │      │ Trigger?│
    │          │      └─┬───┬───┘
    │          │        │NO │YES
    │          │        │   │
    │          │    ┌───┘   └──┐
    │          │    │          │
    ▼          ▼    ▼          ▼
┌──────────────────────────────────┐
│          Enter Order Book         │
└────────────────┬─────────────────┘
                 │
                 ▼
         ┌──────────────┐
         │  Match Found? │
         └───┬────┬─────┘
             │YES │ NO
         ┌───┘    └───┐
         │            │
         ▼            ▼
    ┌────────┐   ┌────────┐
    │ Execute│   │ Pending│
    └────────┘   └────────┘
         │
         ▼
    ┌────────┐
    │ Closed │
    └────────┘
```

---

## Time-in-Force Comparison

| TIF | Immediate Execution | Posts to Book | Partial Fills | Cancels Remainder | Recommended Orders |
|-----|---------------------|---------------|---------------|-------------------|--------------------|
| **GTC** | ❌ | ✅ | ✅ | ❌ | LIMIT |
| **IOC** | ✅ | ❌ | ✅ | ✅ | MARKET, aggressive LIMIT |
| **FOK** | ✅ | ❌ | ❌ | ✅ | Large LIMIT or MARKET |
| **POST_ONLY** | ❌ | ✅ | ✅ | ❌ | Maker-only LIMIT |

---

## Scenario Playbook

### Scenario 1: Buy the Dip 📉
**Goal:** Acquire ETH when price reaches 1,800 USDT.

```javascript
{
  orderType: 'LIMIT',
  side: 'BUY',
  tokenGive: 'USDT',
  amountGive: '1800',
  tokenGet: 'ETH',
  amountGet: '1',
  timeInForce: 'GTC',
  allowPartialFill: true,
}
```

**Why it works:**
- ✅ Locks in a precise entry price
- ✅ Rests on the book until the target is reached
- ✅ Qualifies for maker fees
- ❌ May take time to execute

---

### Scenario 2: Exit Immediately 🚨
**Goal:** Sell ETH for USDT right away.

```javascript
{
  orderType: 'MARKET',
  side: 'SELL',
  tokenGive: 'ETH',
  amountGive: '1',
  timeInForce: 'IOC',
  maxSlippage: 500, // 5%
}
```

**Why it works:**
- ✅ Executes instantly
- ✅ Prioritizes liquidity
- ❌ Price varies with order book depth
- ❌ Higher taker fee

---

### Scenario 3: Protective Stop 🛡️
**Goal:** Automatically sell if ETH drops below 1,900 USDT.

```javascript
{
  orderType: 'STOP_LOSS',
  side: 'SELL',
  tokenGive: 'ETH',
  amountGive: '1',
  stopPrice: '1900',
  timeInForce: 'IOC',
  allowPartialFill: false,
}
```

**Why it works:**
- ✅ Automates downside protection
- ✅ No need to monitor constantly
- ❌ Executes as a market order once triggered
- ❌ Volatility may cause fills below the stop

---

### Scenario 4: Precise Stop 🎯
**Goal:** Trigger at 1,900 USDT but only sell if the limit price of 1,895 is available.

```javascript
{
  orderType: 'STOP_LIMIT',
  side: 'SELL',
  tokenGive: 'ETH',
  amountGive: '1',
  stopPrice: '1900',
  limitPrice: '1895',
  timeInForce: 'GTC',
  allowPartialFill: false,
}
```

**Why it works:**
- ✅ Keeps control of the execution price
- ✅ Still automated based on the stop
- ❌ May not execute if the market gaps below 1,895

---

### Scenario 5: Maker-Only Liquidity 🧱
**Goal:** Provide liquidity without crossing the spread.

```javascript
{
  orderType: 'LIMIT',
  side: 'SELL',
  tokenGive: 'ETH',
  amountGive: '5',
  tokenGet: 'USDT',
  amountGet: '9000',
  timeInForce: 'POST_ONLY',
  allowPartialFill: true,
}
```

**Why it works:**
- ✅ Guarantees maker status
- ✅ Avoids paying taker fees
- ✅ Useful for market-making strategies

---

### Scenario 6: Large Block Trade 🧊
**Goal:** Execute a large order only if the full size can be filled immediately.

```javascript
{
  orderType: 'LIMIT',
  side: 'BUY',
  tokenGive: 'USDT',
  amountGive: '500000',
  tokenGet: 'ETH',
  amountGet: '250',
  timeInForce: 'FOK',
  allowPartialFill: false,
}
```

**Why it works:**
- ✅ Avoids partial fills on illiquid books
- ✅ Cancels automatically if insufficient liquidity exists
- ❌ May fail to execute during volatile periods

---

## Combining Orders

1. **Protective Ladder:** Pair limit buy orders with stop-loss sells to automate entry and exit.
2. **Breakout Strategy:** Place stop-limit buys above resistance while keeping a protective stop-loss in case of false breakouts.
3. **Inventory Management:** Maintain POST_ONLY limit orders on both sides to earn maker fees while keeping stop-loss orders for risk control.

---

## Fee Considerations

| Situation | Recommended Order | Rationale |
|-----------|-------------------|-----------|
| Seeking lowest fees | Limit + POST_ONLY | Maker rebates / lower fees |
| Urgent execution | Market or IOC limit | Pay taker fee for certainty |
| Automated risk off | Stop-loss | Will pay taker fee when triggered |
| Complex automation | Stop-limit | Maintain maker fee profile when possible |

---

## Debugging Tips

- Verify `stopPrice` and `limitPrice` formatting before signing.
- Check wallet confirmations for `eth_signTypedData_v4` requests.
- Ensure the backend has up-to-date market prices for stop logic.
- Log order state transitions to diagnose matching behavior.

---

This reference acts as a quick guide for choosing, configuring, and troubleshooting order types in the extended DEX architecture.

