# Configuration Placeholders

The following runtime values still need to be provided before the DEX backend can interact with an actual blockchain environment:

| Location | Placeholder | Description |
| --- | --- | --- |
| `.env` / environment variables | `RPC_URL` / `JSON_RPC_URL` | HTTP RPC endpoint for the target network. |
| `.env` / environment variables | `PRIVATE_KEY` | Deployer or relayer account used by the backend to sign transactions. |
| `.env` / environment variables | `DEX_ADDRESS` | Deployed `DEX` contract address for querying balances and executing orders. |
| `.env` / environment variables | `MOCK_TOKEN_ARTIFACT_PATH` | Absolute path to the compiled `MockToken` artifact (`MockToken.json`) so the backend can deploy new ERC20 tokens. |
| `backend/data/tokens.json` | Token metadata entries | Populate with the ERC20 addresses (and optional metadata) that should appear in the UI by default. |

> Tip: After compiling the contracts with `npx hardhat compile`, the `MockToken` artifact will be available under `artifacts/contracts/MockToken.sol/MockToken.json`. Update the `MOCK_TOKEN_ARTIFACT_PATH` environment variable to point to this file.
