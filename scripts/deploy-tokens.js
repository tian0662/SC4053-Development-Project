// Deployment script for multiple test tokens
// This script deploys various ERC20 tokens for DEX testing

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const { ensureRpcConnection } = require("./utils/network");

/**
 * Token configuration list
 * Each token will be deployed with the specified parameters
 */
const TOKENS = [
    {
        name: "Test Yuan Dollar",
        symbol: "TYD",
        initialSupply: 1000000  // 1 million tokens
    },
    {
        name: "Test USD Tether",
        symbol: "USDT",
        initialSupply: 10000000  // 10 million tokens
    },
    {
        name: "Test DAI",
        symbol: "DAI",
        initialSupply: 5000000  // 5 million tokens
    },
    {
        name: "Test Wrapped BTC",
        symbol: "WBTC",
        initialSupply: 21000  // 21 thousand tokens (like real BTC supply)
    },
    {
        name: "Test Ethereum",
        symbol: "WETH",
        initialSupply: 1000000  // 1 million tokens
    }
];

/**
 * Main deployment function
 * Deploys all tokens defined in TOKENS array
 */
async function main() {
    console.log("Starting token deployment process...\n");

    await ensureRpcConnection(hre);

    // Get the deployer account
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with account:", deployer.address);
    console.log("Account balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

    // Object to store deployed token addresses
    const deployedTokens = {};

    // Deploy each token
    for (const tokenConfig of TOKENS) {
        console.log(`Deploying ${tokenConfig.name} (${tokenConfig.symbol})...`);
        
        try {
            // Get the contract factory
            const MockToken = await hre.ethers.getContractFactory("MockToken");
            
            // Deploy the contract
            const token = await MockToken.deploy(
                tokenConfig.name,
                tokenConfig.symbol,
                tokenConfig.initialSupply
            );

            // Wait for deployment to complete
            await token.waitForDeployment();
            
            const tokenAddress = await token.getAddress();
            console.log(`✅ ${tokenConfig.symbol} deployed to: ${tokenAddress}`);
            
            // Store the address
            deployedTokens[tokenConfig.symbol] = {
                address: tokenAddress,
                name: tokenConfig.name,
                symbol: tokenConfig.symbol,
                initialSupply: tokenConfig.initialSupply,
                decimals: 18
            };

            // Get token balance of deployer
            const balance = await token.balanceOf(deployer.address);
            console.log(`   Initial balance: ${hre.ethers.formatEther(balance)} ${tokenConfig.symbol}\n`);

        } catch (error) {
            console.error(`❌ Error deploying ${tokenConfig.symbol}:`, error.message);
        }
    }

    // Save deployment information to JSON file
    const deploymentsDir = path.join(__dirname, '../deployments');
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const networkName = hre.network.name;
    const deploymentFile = path.join(deploymentsDir, `tokens-${networkName}.json`);
    
    fs.writeFileSync(
        deploymentFile,
        JSON.stringify({
            network: networkName,
            deployedAt: new Date().toISOString(),
            deployer: deployer.address,
            tokens: deployedTokens
        }, null, 2)
    );

    console.log(`\n📝 Deployment information saved to: ${deploymentFile}`);
    console.log("\n🎉 Token deployment completed successfully!");
    
    // Print summary
    console.log("\n" + "=".repeat(50));
    console.log("DEPLOYMENT SUMMARY");
    console.log("=".repeat(50));
    console.log(`Network: ${networkName}`);
    console.log(`Total tokens deployed: ${Object.keys(deployedTokens).length}`);
    console.log("\nToken Addresses:");
    for (const [symbol, info] of Object.entries(deployedTokens)) {
        console.log(`  ${symbol}: ${info.address}`);
    }
    console.log("=".repeat(50) + "\n");
}

/**
 * Execute the deployment
 * Handle errors and exit appropriately
 */
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Deployment failed:");
        console.error(error);
        process.exit(1);
    });
