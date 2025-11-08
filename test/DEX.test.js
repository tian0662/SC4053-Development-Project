// Unit tests for DEX contract
// Testing all core functionalities: deposit, withdraw, order execution, cancellation

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DEX Contract", function () {
    let dex;
    let tokenA;
    let tokenB;
    let owner;
    let user1;
    let user2;
    let addrs;
    let tokenAAddress;
    let tokenBAddress;

    // EIP-712 Domain and Types for signing orders
    let domain;
    const ORDER_TYPES = {
        Order: [
            { name: "maker", type: "address" },
            { name: "tokenGet", type: "address" },
            { name: "amountGet", type: "uint256" },
            { name: "tokenGive", type: "address" },
            { name: "amountGive", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "expiry", type: "uint256" },
            { name: "orderType", type: "uint8" },
            { name: "timeInForce", type: "uint8" },
            { name: "side", type: "uint8" },
            { name: "stopPrice", type: "uint256" },
            { name: "minFillAmount", type: "uint256" },
            { name: "allowPartialFill", type: "bool" },
            { name: "feeRecipient", type: "address" },
            { name: "feeAmount", type: "uint256" }
        ]
    };

    const ORDER_TYPE = {
        LIMIT: 0,
        MARKET: 1,
        STOP_LOSS: 2,
        STOP_LIMIT: 3
    };

    const TIME_IN_FORCE = {
        GTC: 0,
        IOC: 1,
        FOK: 2,
        POST_ONLY: 3
    };

    const ORDER_SIDE = {
        BUY: 0,
        SELL: 1
    };

    /**
     * Helper function to sign an order using EIP-712
     */
    async function signOrder(order, signer) {
        return await signer.signTypedData(domain, ORDER_TYPES, order);
    }

    const toBigIntLike = (value) => {
        if (value === undefined) {
            return value;
        }

        if (typeof value === "bigint") {
            return value;
        }

        if (typeof value === "number") {
            return BigInt(value);
        }

        if (typeof value === "string") {
            return BigInt(value);
        }

        if (typeof value === "object" && value !== null && typeof value.toBigInt === "function") {
            return value.toBigInt();
        }

        return BigInt(value);
    };

    async function buildOrder(overrides = {}) {
        const maker = overrides.maker ?? user1.address;
        const nonce = toBigIntLike(
            overrides.nonce !== undefined ? overrides.nonce : await dex.getNonce(maker)
        );
        const currentTime = BigInt(await time.latest());
        const expiry = toBigIntLike(
            overrides.expiry !== undefined ? overrides.expiry : currentTime + 3600n
        );

        return {
            maker,
            tokenGet: overrides.tokenGet ?? tokenBAddress,
            amountGet: toBigIntLike(overrides.amountGet ?? ethers.parseEther("50")),
            tokenGive: overrides.tokenGive ?? tokenAAddress,
            amountGive: toBigIntLike(overrides.amountGive ?? ethers.parseEther("100")),
            nonce,
            expiry,
            orderType: overrides.orderType ?? ORDER_TYPE.LIMIT,
            timeInForce: overrides.timeInForce ?? TIME_IN_FORCE.GTC,
            side: overrides.side ?? ORDER_SIDE.SELL,
            stopPrice: toBigIntLike(overrides.stopPrice ?? 0n),
            minFillAmount: toBigIntLike(overrides.minFillAmount ?? 0n),
            allowPartialFill: overrides.allowPartialFill ?? true,
            feeRecipient: overrides.feeRecipient ?? ethers.ZeroAddress,
            feeAmount: toBigIntLike(overrides.feeAmount ?? 0n)
        };
    }

    /**
     * Setup before each test
     * Deploy contracts and distribute tokens
     */
    beforeEach(async function () {
        // Get signers
        [owner, user1, user2, ...addrs] = await ethers.getSigners();

        // Deploy DEX contract
        const DEX = await ethers.getContractFactory("DEX");
        dex = await DEX.deploy();
        await dex.waitForDeployment();

        // Deploy two test tokens
        const MockToken = await ethers.getContractFactory("MockToken");

        tokenA = await MockToken.deploy("Token A", "TKA", 1000000);
        await tokenA.waitForDeployment();

        tokenB = await MockToken.deploy("Token B", "TKB", 1000000);
        await tokenB.waitForDeployment();

        tokenAAddress = await tokenA.getAddress();
        tokenBAddress = await tokenB.getAddress();

        // Setup EIP-712 domain
        const chainId = (await ethers.provider.getNetwork()).chainId;
        domain = {
            name: "DEX",
            version: "1",
            chainId: chainId,
            verifyingContract: await dex.getAddress()
        };

        // Distribute tokens to users
        const amount = ethers.parseEther("10000");
        await tokenA.transfer(user1.address, amount);
        await tokenA.transfer(user2.address, amount);
        await tokenB.transfer(user1.address, amount);
        await tokenB.transfer(user2.address, amount);
    });

    // ============ Deposit & Withdraw Tests ============

    describe("Deposit & Withdraw", function () {
        it("Should allow users to deposit tokens", async function () {
            const depositAmount = ethers.parseEther("100");

            // Approve DEX to spend tokens
            await tokenA.connect(user1).approve(await dex.getAddress(), depositAmount);

            // Deposit tokens
            await expect(dex.connect(user1).deposit(tokenAAddress, depositAmount))
                .to.emit(dex, "Deposit")
                .withArgs(user1.address, tokenAAddress, depositAmount, depositAmount);

            // Check balance in DEX
            expect(await dex.balanceOf(user1.address, tokenAAddress)).to.equal(depositAmount);
        });

        it("Should allow users to withdraw tokens", async function () {
            const depositAmount = ethers.parseEther("100");
            const withdrawAmount = ethers.parseEther("50");

            // First deposit
            await tokenA.connect(user1).approve(await dex.getAddress(), depositAmount);
            await dex.connect(user1).deposit(tokenAAddress, depositAmount);

            // Then withdraw
            const balanceBefore = await tokenA.balanceOf(user1.address);

            await expect(dex.connect(user1).withdraw(tokenAAddress, withdrawAmount))
                .to.emit(dex, "Withdraw")
                .withArgs(user1.address, tokenAAddress, withdrawAmount, depositAmount - withdrawAmount);

            // Check balances
            expect(await dex.balanceOf(user1.address, tokenAAddress)).to.equal(depositAmount - withdrawAmount);
            expect(await tokenA.balanceOf(user1.address)).to.equal(balanceBefore + withdrawAmount);
        });

        it("Should revert when withdrawing more than balance", async function () {
            const depositAmount = ethers.parseEther("100");
            const withdrawAmount = ethers.parseEther("200");

            // Deposit
            await tokenA.connect(user1).approve(await dex.getAddress(), depositAmount);
            await dex.connect(user1).deposit(tokenAAddress, depositAmount);

            // Try to withdraw more than deposited
            await expect(
                dex.connect(user1).withdraw(tokenAAddress, withdrawAmount)
            ).to.be.revertedWith("DEX: Insufficient balance");
        });

        it("Should revert when depositing zero amount", async function () {
            await expect(
                dex.connect(user1).deposit(tokenAAddress, 0)
            ).to.be.revertedWith("DEX: Amount must be greater than 0");
        });
    });

    // ============ Order Hash & Signature Tests ============

    describe("Order Hash & Signature Verification", function () {
        it("Should correctly calculate order hash", async function () {
            const order = await buildOrder();

            const orderHash = await dex.getOrderHash(order);
            expect(orderHash).to.be.properHex(64);
        });

        it("Should verify valid signature", async function () {
            const order = await buildOrder();

            const signature = await signOrder(order, user1);
            expect(await dex.verifyOrder(order, signature)).to.be.true;
        });

        it("Should reject invalid signature", async function () {
            const order = await buildOrder();

            // Sign with wrong user
            const signature = await signOrder(order, user2);
            expect(await dex.verifyOrder(order, signature)).to.be.false;
        });
    });

    // ============ Order Execution Tests ============

    describe("Order Execution", function () {
        it("Should execute a complete order successfully", async function () {
            // User1 deposits TokenA
            const user1DepositAmount = ethers.parseEther("100");
            await tokenA.connect(user1).approve(await dex.getAddress(), user1DepositAmount);
            await dex.connect(user1).deposit(tokenAAddress, user1DepositAmount);

            // User2 deposits TokenB
            const user2DepositAmount = ethers.parseEther("50");
            await tokenB.connect(user2).approve(await dex.getAddress(), user2DepositAmount);
            await dex.connect(user2).deposit(tokenBAddress, user2DepositAmount);

            const order = await buildOrder({
                nonce: await dex.getNonce(user1.address)
            });

            const signature = await signOrder(order, user1);

            // User2 executes the order (taker)
            await expect(
                dex.connect(user2).executeOrder(order, signature, ethers.parseEther("100"))
            ).to.emit(dex, "OrderExecuted");

            // Check balances after execution
            expect(await dex.balanceOf(user1.address, tokenAAddress)).to.equal(0);
            expect(await dex.balanceOf(user1.address, tokenBAddress)).to.equal(ethers.parseEther("50"));
            expect(await dex.balanceOf(user2.address, tokenAAddress)).to.equal(ethers.parseEther("100"));
            expect(await dex.balanceOf(user2.address, tokenBAddress)).to.equal(0);
        });

        it("Should support partial order fills", async function () {
            // User1 deposits TokenA
            await tokenA.connect(user1).approve(await dex.getAddress(), ethers.parseEther("100"));
            await dex.connect(user1).deposit(tokenAAddress, ethers.parseEther("100"));

            // User2 deposits TokenB
            await tokenB.connect(user2).approve(await dex.getAddress(), ethers.parseEther("50"));
            await dex.connect(user2).deposit(tokenBAddress, ethers.parseEther("50"));

            const order = await buildOrder({
                nonce: await dex.getNonce(user1.address)
            });

            const signature = await signOrder(order, user1);

            // User2 fills only 50% of the order (50 TokenA for 25 TokenB)
            await dex.connect(user2).executeOrder(order, signature, ethers.parseEther("50"));

            // Check partial fill
            const orderHash = await dex.getOrderHash(order);
            expect(await dex.getFilledAmount(orderHash)).to.equal(ethers.parseEther("50"));
            expect(await dex.getRemainingAmount(order)).to.equal(ethers.parseEther("50"));

            // Check balances
            expect(await dex.balanceOf(user1.address, tokenAAddress)).to.equal(ethers.parseEther("50"));
            expect(await dex.balanceOf(user1.address, tokenBAddress)).to.equal(ethers.parseEther("25"));
        });

        it("Should revert when order is expired", async function () {
            // Deposits
            await tokenA.connect(user1).approve(await dex.getAddress(), ethers.parseEther("100"));
            await dex.connect(user1).deposit(tokenAAddress, ethers.parseEther("100"));
            await tokenB.connect(user2).approve(await dex.getAddress(), ethers.parseEther("50"));
            await dex.connect(user2).deposit(tokenBAddress, ethers.parseEther("50"));

            const order = await buildOrder({
                nonce: await dex.getNonce(user1.address),
                expiry: BigInt(await time.latest()) + 10n
            });

            const signature = await signOrder(order, user1);

            // Fast forward time past expiry
            await time.increase(20);

            // Try to execute expired order
            await expect(
                dex.connect(user2).executeOrder(order, signature, ethers.parseEther("100"))
            ).to.be.revertedWith("DEX: Order is not valid");
        });

        it("Should revert when maker has insufficient balance", async function () {
            // User1 deposits only 50 TokenA
            await tokenA.connect(user1).approve(await dex.getAddress(), ethers.parseEther("50"));
            await dex.connect(user1).deposit(tokenAAddress, ethers.parseEther("50"));

            // User2 deposits TokenB
            await tokenB.connect(user2).approve(await dex.getAddress(), ethers.parseEther("50"));
            await dex.connect(user2).deposit(tokenBAddress, ethers.parseEther("50"));

            const order = await buildOrder({
                nonce: await dex.getNonce(user1.address)
            });

            const signature = await signOrder(order, user1);

            // Try to execute - should fail
            await expect(
                dex.connect(user2).executeOrder(order, signature, ethers.parseEther("100"))
            ).to.be.revertedWith("DEX: Maker has insufficient balance");
        });
    });

    // ============ Order Cancellation Tests ============

    describe("Order Cancellation", function () {
        it("Should allow maker to cancel their order", async function () {
            const order = await buildOrder({
                nonce: await dex.getNonce(user1.address)
            });

            const orderHash = await dex.getOrderHash(order);

            // Cancel order
            await expect(dex.connect(user1).cancelOrder(order))
                .to.emit(dex, "OrderCancelled")
                .withArgs(orderHash, user1.address, "Cancelled by maker");

            // Check if order is cancelled
            expect(await dex.isCancelled(orderHash)).to.be.true;
        });

        it("Should prevent non-maker from cancelling order", async function () {
            const order = await buildOrder({
                nonce: await dex.getNonce(user1.address)
            });

            // User2 tries to cancel User1's order
            await expect(
                dex.connect(user2).cancelOrder(order)
            ).to.be.revertedWith("DEX: Only maker can cancel order");
        });

        it("Should prevent execution of cancelled order", async function () {
            // Deposits
            await tokenA.connect(user1).approve(await dex.getAddress(), ethers.parseEther("100"));
            await dex.connect(user1).deposit(tokenAAddress, ethers.parseEther("100"));
            await tokenB.connect(user2).approve(await dex.getAddress(), ethers.parseEther("50"));
            await dex.connect(user2).deposit(tokenBAddress, ethers.parseEther("50"));

            const order = await buildOrder({
                nonce: await dex.getNonce(user1.address)
            });

            const signature = await signOrder(order, user1);

            // Cancel order
            await dex.connect(user1).cancelOrder(order);

            // Try to execute cancelled order
            await expect(
                dex.connect(user2).executeOrder(order, signature, ethers.parseEther("100"))
            ).to.be.revertedWith("DEX: Order is not valid");
        });

        it("Should allow batch cancellation of orders", async function () {
            const orders = [];
            for (let i = 0; i < 3; i++) {
                orders.push(
                    await buildOrder({
                        nonce: BigInt(i)
                    })
                );
            }

            // Batch cancel
            await dex.connect(user1).cancelOrders(orders);

            // Check all orders are cancelled
            for (const order of orders) {
                const orderHash = await dex.getOrderHash(order);
                expect(await dex.isCancelled(orderHash)).to.be.true;
            }
        });
    });

    // ============ Nonce Tests ============

    describe("Nonce Management", function () {
        it("Should allow user to increment nonce", async function () {
            const initialNonce = await dex.getNonce(user1.address);

            await expect(dex.connect(user1).incrementNonce())
                .to.emit(dex, "NonceIncremented")
                .withArgs(user1.address, initialNonce + 1n);

            expect(await dex.getNonce(user1.address)).to.equal(initialNonce + 1n);
        });

        it("Should invalidate orders with old nonce after increment", async function () {
            // Create order with nonce 0
            const order = await buildOrder({ nonce: 0n });

            // Increment nonce to 1
            await dex.connect(user1).incrementNonce();

            // Order with nonce 0 should now be invalid
            expect(await dex.isOrderValid(order)).to.be.false;
        });
    });
});
