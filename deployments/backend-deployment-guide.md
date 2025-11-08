# Backend Deployment & Integration Guide

This guide explains how to boot the backend service for the DEX project and which HTTP
interfaces the frontend should target. It assumes you are deploying the Node.js backend
included in this repository.

## 1. Prerequisites

- **Runtime**: Node.js 18+ and npm.
- **Environment variables**: Create a `.env` (or `.env.production`) file in the project
  root. The backend reads configuration via `backend/config/config.js` and supports the
  following keys:
  - `PORT` (or `API_PORT`): port for the HTTP server (default `4000`).
  - `DATABASE_URL` / `MONGODB_URI`: MongoDB connection string (not yet used by the in-memory
    prototype but required once persistence is enabled).
  - `RPC_URL` / `JSON_RPC_URL`: HTTPS RPC endpoint for the target blockchain network.
  - `RPC_WS_URL` / `WS_RPC_URL`: WebSocket RPC endpoint (used by the event listener service).
  - `DEX_ADDRESS`: Address of the deployed DEX contract.
  - `PRIVATE_KEY`: Private key for the backend signer (if transactions need to be
    submitted on-chain).

  You can also drop compiled deployment artifacts under the `deployments/` directory
  (e.g. `dex-local.json`) and the config loader will pick up the contract address and ABI
  automatically.

## 2. Installing dependencies

```bash
npm install
```

This installs both backend and smart-contract dependencies (defined in `package.json`).

## 3. Starting the backend server

```bash
node backend/server.js
```

The entry point wires the REST routes and starts listening on the configured port. Add a
process manager (PM2, Docker, etc.) as needed for production deployments.

## 4. Essential API endpoints for the frontend

All endpoints are prefixed with `/api` and served by the Express application defined in
`backend/server.js`.

### 4.1 Orders resource (`/api/orders`)

- `GET /api/orders`: List orders filtered by `baseToken`, `quoteToken`, `trader`, or
  `status` query parameters.
- `GET /api/orders/book`: Return the current order book for a token pair (requires
  `baseToken` and `quoteToken` query params).
- `GET /api/orders/trades`: Fetch recent trades for a pair (`baseToken` and `quoteToken`
  required, optional `limit`).
- `POST /api/orders`: Submit a new order (limit, market, stop, or stop-limit). Accepts a JSON
  payload matching the `Order` model schema and returns the created order with normalized
  enums and timestamps.
- `POST /api/orders/batch`: Trigger cyclic batch execution for a set of compatible orders.
  Body shape: `{ "orderIds": ["..."], "tolerance": number }`.
- `POST /api/orders/market-price`: Update the reference market price for a trading pair.
  Body shape: `{ "baseToken": string, "quoteToken": string, "price": number }`.
- `GET /api/orders/:id`: Fetch a single order by ID.
- `POST /api/orders/:id/cancel`: Cancel an existing order (optional `{ "reason": string }`
  body) and retrieve the updated record.

### 4.2 Tokens resource (`/api/tokens`)

The route currently returns an empty array placeholder. Integrate once token discovery is
implemented or mock the response on the frontend until the service is completed.

### 4.3 Users resource (`/api/users`)

Also a placeholder that returns an empty array; plan for future user/account features.

### 4.4 Health check

`GET /health` returns `{ "status": "ok" }` and can be used by load balancers or uptime
monitors.

## 5. Background services

The backend already ships with utility modules for blockchain access
(`backend/services/blockchain.service.js`) and event streaming
(`backend/services/event-listener.service.js`). When you introduce them into the runtime
(e.g. in a future `backend/app.js` entry point), ensure the RPC URLs and contract artifacts
are configured before booting the listener.

## 6. Suggested deployment flow

1. Populate `.env` with RPC credentials, contract addresses, and database URL.
2. Install dependencies (`npm install`).
3. Build/start any required blockchain nodes or external services.
4. Launch the backend (`node backend/server.js`) and verify `/health`.
5. Point the frontend environment variables to the backend base URL so that order-related
   API calls hit the endpoints listed above.

## 7. Roadmap for persistence

Current services still use in-memory storage. To avoid data loss in production, wire the
MongoDB connection exposed in `config.database.url`, migrate the `Order` model to a Mongoose
schema, and replace the in-memory maps inside `backend/services/order.service.js` with
actual database CRUD operations.

