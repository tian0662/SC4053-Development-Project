# DEX Smart Contracts - Off-Chain Order Book

## 📋 Project Overview

This repository contains the smart contracts and supporting scripts for an off-chain order book Decentralized Exchange (DEX). Orders are created and matched off-chain while settlements are executed on-chain, dramatically reducing gas costs and improving the trading experience.

## 🏗️ Architecture

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Frontend  │◄────►│   Backend   │◄────►│  Blockchain │
│   (React)   │      │  (Node.js)  │      │  (Ethereum) │
└─────────────┘      └─────────────┘      └─────────────┘
      │                     │                     │
      │                     │                     │
  User Interface      Matching Engine      Smart Contract
                                           Execution
```

## 📁 File Structure

```
contracts/
├── MockToken.sol       # ERC20 test token contract
├── DEX.sol             # Core DEX contract

scripts/
├── deploy-tokens.js    # Token deployment script
└── deploy-dex.js       # DEX deployment script

test/
└── DEX.test.js         # Contract tests

hardhat.config.js       # Hardhat configuration
.env.example            # Environment variable template
```

## 🔑 Core Contract Features

### MockToken.sol
- ✅ Standard ERC20 implementation
- ✅ Mint capability for testing
- ✅ Burn support
- ✅ 18 decimal precision

### DEX.sol
- ✅ **Deposit and withdrawal management**: `deposit()`, `withdraw()`, `balanceOf()`
- ✅ **Order structure**: EIP-712 typed data signatures
- ✅ **Order validation**: `verifyOrder()`, `isOrderValid()`
- ✅ **Order execution**: `executeOrder()` with partial fills
- ✅ **Order cancellation**: `cancelOrder()`, `cancelOrders()`, `incrementNonce()`
- ✅ **Security**: ReentrancyGuard, signature checks, expiry validation

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts dotenv
```

### 2. Configure the Environment

```bash
cp .env.example .env
# Edit the .env file with your RPC endpoints and private keys
```

### 3. Compile Contracts

```bash
npx hardhat compile
```

### 4. Run Tests

```bash
npx hardhat test
```

Expected output:

```
DEX Contract
  Deposit & Withdraw
    ✔ Should allow users to deposit tokens
    ✔ Should allow users to withdraw tokens
    ✔ Should revert when withdrawing more than balance
  Order Execution
    ✔ Should execute a complete order successfully
    ✔ Should support partial order fills
  Order Cancellation
    ✔ Should allow maker to cancel their order
    ✔ Should prevent execution of cancelled order
```

### 5. Deploy to a Local Network

```bash
# Terminal 1: start a local Hardhat node
npx hardhat node

# Terminal 2: deploy the contracts
# The scripts verify that the RPC endpoint is online before connecting
npx hardhat run scripts/deploy-tokens.js --network localhost
npx hardhat run scripts/deploy-dex.js --network localhost
```

> ℹ️ If the deployment script cannot connect to `localhost RPC`, ensure the Hardhat node is still running in Terminal 1 or restart it with `npx hardhat node`.

### 6. Deploy to Sepolia Testnet

```bash
# Deploy to the Sepolia test network
npx hardhat run scripts/deploy-tokens.js --network sepolia
npx hardhat run scripts/deploy-dex.js --network sepolia

# Verify contracts on Etherscan
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

### 7. Start the Backend

```bash
node -e "require('./backend/server').startServer()"
```

### 8. Start the Frontend

```bash
npm run dev
```

## 📊 Gas Cost Estimates

| Operation       | Gas Cost (approx.) |
|-----------------|--------------------|
| Deposit         | ~50,000 gas        |
| Withdraw        | ~40,000 gas        |
| Execute Order   | ~150,000 gas       |
| Cancel Order    | ~30,000 gas        |

## 🔐 Security Features

### 1. ReentrancyGuard
Prevents reentrancy attacks and keeps state transitions atomic.

### 2. EIP-712 Signatures
Uses the EIP-712 signing standard so that users can review readable order payloads.

### 3. Nonce Management
Maintains a per-user nonce to prevent signature replay attacks.

### 4. Expiry Validation
Orders include expiry timestamps and become invalid automatically after they elapse.

## 📝 Order Structure

Refer to `ORDER_EXTENSION_GUIDE.md` and `ORDER_TYPES_COMPARISON.md` for the full typed data structure, enumerations, and lifecycle examples.

