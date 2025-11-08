// Deployment script for DEX contract
// This script deploys the main DEX contract

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const { ensureRpcConnection } = require("./utils/network");

/**
 * Main deployment function
 * Deploys the DEX contract and saves deployment information
 */
async function main() {
    console.log("Starting DEX contract deployment...\n");

    await ensureRpcConnection(hre);

    // Get the deployer account
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying DEX contract with account:", deployer.address);
    console.log("Account balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

    try {
        // Get the contract factory
        const DEX = await hre.ethers.getContractFactory("DEX");
        
        console.log("Deploying DEX contract...");
        
        // Deploy the contract
        const dex = await DEX.deploy();

        // Wait for deployment to complete
        await dex.waitForDeployment();
        
        const dexAddress = await dex.getAddress();
        console.log("✅ DEX contract deployed to:", dexAddress);

        // Get deployment transaction details
        const deploymentTx = dex.deploymentTransaction();
        console.log("   Deployment transaction hash:", deploymentTx.hash);
        console.log("   Block number:", deploymentTx.blockNumber);

        // Get EIP-712 domain information
        const domainName = "DEX";
        const domainVersion = "1";
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
        
        console.log("\n📝 EIP-712 Domain Information:");
        console.log("   Name:", domainName);
        console.log("   Version:", domainVersion);
        console.log("   Chain ID:", chainId);
        console.log("   Verifying Contract:", dexAddress);

        // Prepare deployment information
        const deploymentInfo = {
            network: hre.network.name,
            chainId: Number(chainId),
            deployedAt: new Date().toISOString(),
            deployer: deployer.address,
            dex: {
                address: dexAddress,
                deploymentTx: deploymentTx.hash,
                blockNumber: deploymentTx.blockNumber
            },
            eip712: {
                name: domainName,
                version: domainVersion,
                chainId: Number(chainId),
                verifyingContract: dexAddress
            }
        };

        // Load existing token deployments if available
        const networkName = hre.network.name;
        const tokenDeploymentFile = path.join(__dirname, '../deployments', `tokens-${networkName}.json`);
        
        if (fs.existsSync(tokenDeploymentFile)) {
            const tokenDeployments = JSON.parse(fs.readFileSync(tokenDeploymentFile, 'utf8'));
            deploymentInfo.tokens = tokenDeployments.tokens;
            console.log("\n✅ Loaded existing token deployments");
        }

        // Save deployment information to JSON file
        const deploymentsDir = path.join(__dirname, '../deployments');
        if (!fs.existsSync(deploymentsDir)) {
            fs.mkdirSync(deploymentsDir, { recursive: true });
        }

        const deploymentFile = path.join(deploymentsDir, `dex-${networkName}.json`);
        
        fs.writeFileSync(
            deploymentFile,
            JSON.stringify(deploymentInfo, null, 2)
        );

        console.log(`\n📝 Deployment information saved to: ${deploymentFile}`);

        // Create a consolidated config file for backend use
        const backendConfigFile = path.join(deploymentsDir, `config-${networkName}.json`);
        fs.writeFileSync(
            backendConfigFile,
            JSON.stringify(deploymentInfo, null, 2)
        );
        console.log(`📝 Backend config saved to: ${backendConfigFile}`);

        // Print summary
        console.log("\n" + "=".repeat(60));
        console.log("DEX DEPLOYMENT SUMMARY");
        console.log("=".repeat(60));
        console.log(`Network: ${networkName}`);
        console.log(`Chain ID: ${chainId}`);
        console.log(`DEX Address: ${dexAddress}`);
        console.log(`Deployer: ${deployer.address}`);
        
        if (deploymentInfo.tokens) {
            console.log(`\nSupported Tokens: ${Object.keys(deploymentInfo.tokens).length}`);
            for (const [symbol, info] of Object.entries(deploymentInfo.tokens)) {
                console.log(`  ${symbol}: ${info.address}`);
            }
        }
        
        console.log("=".repeat(60));

        // Verification instructions for Etherscan
        if (networkName !== 'localhost' && networkName !== 'hardhat') {
            console.log("\n📋 To verify the contract on Etherscan, run:");
            console.log(`npx hardhat verify --network ${networkName} ${dexAddress}`);
        }

        console.log("\n🎉 DEX deployment completed successfully!");
        console.log("\n💡 Next steps:");
        console.log("   1. Verify the contract on Etherscan (if on testnet)");
        console.log("   2. Update backend configuration with the DEX address");
        console.log("   3. Test deposit and withdrawal functions");
        console.log("   4. Start the backend matching engine");
        console.log("   5. Deploy and configure the frontend\n");

    } catch (error) {
        console.error("\n❌ DEX deployment failed:");
        console.error(error);
        throw error;
    }
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
