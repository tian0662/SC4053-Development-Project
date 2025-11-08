// Hardhat configuration for DEX project
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/**
 * Helper to normalise and validate private keys sourced from environment variables.
 * Accepts a single environment key or an array of keys (checked in order) and
 * returns a list of 0x-prefixed, 64-hex-character private keys. Any placeholder
 * or malformed values are ignored to prevent Hardhat from throwing HH8 errors.
 *
 * @param {string|string[]} envKeys
 * @returns {string[]}
 */
function resolveAccounts(envKeys) {
    const keysToInspect = Array.isArray(envKeys) ? envKeys : [envKeys];
    for (const envKey of keysToInspect) {
        const raw = process.env[envKey];
        if (!raw) {
            continue;
        }

        const accounts = raw
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .map((value) => (value.startsWith("0x") ? value : `0x${value}`))
            .filter((value) => /^0x[0-9a-fA-F]{64}$/.test(value));

        if (accounts.length > 0) {
            return accounts;
        }
    }

    return [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            },
            viaIR: true
        }
    },
    
    networks: {
        // Local Hardhat Network
        hardhat: {
            chainId: 31337
        },
        
        // Localhost network (for testing with `npx hardhat node`)
        localhost: {
            url: "http://127.0.0.1:8545",
            chainId: 31337
        },
        
        // Sepolia Testnet
        sepolia: {
            url: process.env.SEPOLIA_RPC_URL || "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
            accounts: resolveAccounts(["SEPOLIA_PRIVATE_KEY", "PRIVATE_KEY"]),
            chainId: 11155111
        },

        // Goerli Testnet (deprecated but still available)
        goerli: {
            url: process.env.GOERLI_RPC_URL || "https://goerli.infura.io/v3/YOUR_INFURA_KEY",
            accounts: resolveAccounts(["GOERLI_PRIVATE_KEY", "PRIVATE_KEY"]),
            chainId: 5
        }
    },
    
    // Etherscan verification
    etherscan: {
        apiKey: {
            sepolia: process.env.ETHERSCAN_API_KEY || "",
            goerli: process.env.ETHERSCAN_API_KEY || ""
        }
    },
    
    // Gas reporter configuration
    gasReporter: {
        enabled: process.env.REPORT_GAS === "true",
        currency: "USD",
        coinmarketcap: process.env.COINMARKETCAP_API_KEY || ""
    },
    
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts"
    }
};
