# 📁 DEX Project File Structure

## Project Layout

```
dex-project/
│
├── contracts/                    # Smart contracts
│   ├── DEX.sol                  # ✅ Core DEX contract
│   ├── MockToken.sol            # ✅ ERC20 test token
│   └── interfaces/              # Optional interfaces
│       └── IERC20.sol
│
├── scripts/                      # Deployment scripts
│   ├── deploy-tokens.js         # ✅ Token deployment
│   └── deploy-dex.js            # ✅ DEX deployment
│
├── test/                         # Automated tests
│   ├── DEX.test.js              # ✅ Core contract tests
│   ├── MockToken.test.js        # Optional token tests
│   └── integration.test.js      # Planned integration tests
│
├── deployments/                  # Auto-generated deployment artifacts
│   ├── tokens-localhost.json
│   ├── dex-localhost.json
│   ├── tokens-sepolia.json
│   └── config-sepolia.json
│
├── backend/                      # 🔜 Backend services
│   ├── config/
│   │   └── config.js
│   ├── models/
│   │   └── Order.js
│   ├── services/
│   │   ├── blockchain.service.js
│   │   ├── matching.service.js
│   │   ├── order.service.js
│   │   └── event-listener.service.js
│   ├── api/
│   │   └── routes/
│   └── server.js
│
├── frontend/                     # 🔜 React application
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   └── App.jsx
│   └── package.json
│
├── hardhat.config.js            # ✅ Hardhat configuration
├── package.json                 # ✅ Project dependencies
├── .env.example                 # ✅ Environment variable template
├── .env                         # Local environment overrides (not committed)
├── README_CONTRACTS.md          # ✅ Contract documentation
└── .gitignore                   # Git ignore list
```

## Completed Assets ✅

### 1. Smart Contracts

#### `MockToken.sol`
- ERC20 implementation with mint and burn helpers
- 18 decimal precision
- Provides multiple test tokens for the DEX

#### `DEX.sol`
- Off-chain order book settlement contract
- Deposit and withdrawal management
- EIP-712 order signatures
- Order execution and cancellation logic
- Defensive security checks

### 2. Deployment Scripts

#### `deploy-tokens.js`
- Deploys a suite of five ERC20 test tokens
- Persists deployment metadata to JSON
- Supports both local and Sepolia networks

#### `deploy-dex.js`
- Deploys the DEX contract
- Produces the EIP-712 domain configuration
- Stores contract address and metadata for the backend

### 3. Tests

#### `DEX.test.js`
- End-to-end unit tests
- Covers deposits, withdrawals, execution, cancellation, and edge cases

### 4. Configuration

#### `hardhat.config.js`
- Network configuration for localhost, Sepolia, and Goerli
- Etherscan verification helpers

#### `package.json`
- Dependency management
- NPM scripts for build, test, and deployment

#### `.env.example`
- Template for RPC URLs, private keys, and optional tooling keys

## Usage Guide

### Initialize the Project

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Populate the .env file with your configuration
   ```
3. **Compile contracts**
   ```bash
   npm run compile
   ```
4. **Run tests**
   ```bash
   npm test
   ```

### Deployment Workflow

#### Local Network
```bash
# Terminal 1: start the local node
npm run node

# Terminal 2: deploy contracts
npm run deploy:local
```

#### Sepolia Testnet
```bash
npm run deploy:sepolia
```

### File Relationship Diagram

```
MockToken.sol ──┐
                ├──► deploy-tokens.js ──► deployments/tokens-*.json
                │
                └──► DEX.test.js

DEX.sol ────────┬──► deploy-dex.js ──────► deployments/dex-*.json
                │
                └──► DEX.test.js

hardhat.config.js ──► used by all scripts and tests

.env ───────────────► consumed by hardhat.config.js
```

## Upcoming Development

### Phase 2: Backend Services (Weeks 8–9)
- `backend/config/config.js` – environment loading and validation
- `backend/models/Order.js` – persistence model
- `backend/services/blockchain.service.js` – provider management and contract helpers
- `backend/services/matching.service.js` – matching engine
- `backend/services/order.service.js` – business logic wrapper
- `backend/services/event-listener.service.js` – blockchain event ingestion
- `backend/api/routes/*.js` – REST endpoints for orders, tokens, and users
- Utility helpers such as `signature.js` and `logger.js`

### Phase 3: Frontend (Weeks 9–10)
Planned React components:
- `WalletConnect.jsx`
- `OrderForm.jsx`
- `OrderBook.jsx`
- `TradeHistory.jsx`
- `Balance.jsx`

## Coding Standards

### Solidity
- Use Solidity `^0.8.20`
- Follow OpenZeppelin style conventions
- Include NatSpec comments for public functions
- Emit events for state-changing operations

### JavaScript
- Prefer modern ES modules and async/await
- Handle errors explicitly with descriptive messages
- Keep functions small and well commented

### Testing
- Mocha + Chai test stack
- Include both success and failure scenarios
- Target ≥80% coverage before production release

## Project Timeline

- [x] Week 7 – Smart contract delivery ✅
  - [x] MockToken.sol
  - [x] DEX.sol
  - [x] Unit tests
  - [x] Deployment scripts

- [ ] Week 8 – Backend services
  - [ ] Database schema
  - [ ] REST API
  - [ ] Matching engine

- [ ] Week 9 – Frontend application
  - [ ] Component implementation
  - [ ] Web3 integration

- [ ] Week 10 – Integration testing
  - [ ] End-to-end coverage
  - [ ] Performance optimizations

- [ ] Weeks 11–12 – Documentation and presentation
  - [ ] Technical documentation
  - [ ] Demo preparation

## Key Reminders

1. **Protect secrets**
   - Do not commit `.env`
   - Keep private keys confidential
   - Guard API tokens
2. **Test first**
   - Run the automated test suite before every commit
   - Ensure all tests pass prior to deployment
3. **Optimize gas usage**
   - Batch operations when possible
   - Favor storage-efficient data structures
4. **Prioritize security**
   - Mitigate reentrancy and validation issues
   - Sanitize and validate every external input

---

**Current status:** Week 7 complete ✅  
**Next milestone:** Week 8 backend services 🔜

