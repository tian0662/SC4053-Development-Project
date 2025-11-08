// Utility helpers for interacting with JSON-RPC endpoints used by the
// deployment scripts. Extracted to a shared module so token and DEX
// deployments can reuse the same connectivity guard.

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 2000;

const JSON_RPC_PING_PAYLOAD = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_chainId",
    params: []
};

/**
 * Sends a lightweight JSON-RPC request to verify the endpoint is reachable.
 * Throws when the request cannot be completed within the timeout or the
 * response is malformed.
 *
 * @param {string} url - JSON-RPC endpoint URL
 * @param {AbortSignal} signal - optional abort signal for timeout handling
 * @throws {Error}
 */
async function pingJsonRpc(url, signal) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(JSON_RPC_PING_PAYLOAD),
        signal
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    if (typeof payload !== "object" || payload === null || typeof payload.result === "undefined") {
        throw new Error("Unexpected JSON-RPC response");
    }
}

/**
 * Ensures the configured Hardhat network RPC endpoint can be reached before
 * attempting any deployment logic. For localhost deployments, this provides
 * a more actionable error message when the user forgets to keep
 * `npx hardhat node` running in another terminal.
 *
 * @param {import("hardhat").HardhatRuntimeEnvironment} hre
 * @param {object} [options]
 * @param {number} [options.attempts]
 * @param {number} [options.intervalMs]
 * @param {number} [options.timeoutMs]
 */
async function ensureRpcConnection(hre, options = {}) {
    const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const networkName = hre.network.name;
    const rpcUrl = hre.network.config && "url" in hre.network.config ? hre.network.config.url : undefined;

    // In-process Hardhat network does not expose an external RPC URL.
    if (!rpcUrl) {
        return;
    }

    const label = `${networkName} RPC (${rpcUrl})`;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (attempt === 1) {
            console.log(`\n🔌 Checking connectivity to ${label}...`);
        } else {
            console.log(`   Retrying connection (${attempt}/${attempts})...`);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            await pingJsonRpc(rpcUrl, controller.signal);
            clearTimeout(timeoutId);
            console.log(`✅ Connected to ${label}`);
            return;
        } catch (err) {
            clearTimeout(timeoutId);

            let error = err;
            if (error && error.name === "AbortError") {
                // Normalise abort errors across Node versions for clearer output.
                error = new Error(`RPC request timed out after ${timeoutMs}ms`);
            }

            if (attempt < attempts) {
                await new Promise((resolve) => setTimeout(resolve, intervalMs));
                continue;
            }

            const guidance =
                networkName === "localhost"
                    ? "Ensure `npx hardhat node` is running in another terminal and listening on this port before executing deployment scripts."
                    : "Verify the RPC URL is correct and reachable from your machine.";

            throw new Error(`Unable to reach ${label}. ${guidance}\nOriginal error: ${error.message}`);
        }
    }
}

module.exports = {
    ensureRpcConnection
};

