// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title DEX - Advanced Decentralized Exchange with Extended Order Types
 * @dev Combines the original DEX and DEX_Extended functionality into a single
 *      contract that supports both the foundational order flow and advanced
 *      trading features like stop orders, time-in-force options, and fees.
 */
contract DEX is ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;

    // ============ Enums ============

    /**
     * @dev Order types supported by the DEX
     */
    enum OrderType {
        LIMIT, // Standard limit order - fill at specified price or better
        MARKET, // Market order - fill immediately at best available price
        STOP_LOSS, // Stop-loss order - trigger when price reaches stop price
        STOP_LIMIT // Stop-limit order - become limit order when stop price reached
    }

    /**
     * @dev Time-in-force options for orders
     */
    enum TimeInForce {
        GTC, // Good-Till-Cancelled - remains active until filled or cancelled
        IOC, // Immediate-Or-Cancel - execute immediately, cancel remaining
        FOK, // Fill-Or-Kill - must be filled completely or cancelled entirely
        POST_ONLY // Post-Only - must be maker (add liquidity), reject if taker
    }

    /**
     * @dev Order side (buy or sell)
     */
    enum OrderSide {
        BUY, // Buy order - user wants to buy tokenGet with tokenGive
        SELL // Sell order - user wants to sell tokenGive for tokenGet
    }

    /**
     * @dev Order status
     */
    enum OrderStatus {
        PENDING, // Order created but not yet executed
        PARTIAL, // Order partially filled
        FILLED, // Order completely filled
        CANCELLED, // Order cancelled by maker
        EXPIRED, // Order expired
        REJECTED // Order rejected (e.g., FOK that can't be filled)
    }

    // ============ Structures ============

    /**
     * @dev Extended order structure with advanced features
     */
    struct Order {
        address maker; // Address of the order creator
        address tokenGet; // Token the maker wants to receive
        uint256 amountGet; // Amount of tokenGet the maker wants
        address tokenGive; // Token the maker wants to give
        uint256 amountGive; // Amount of tokenGive the maker wants to give
        uint256 nonce; // Unique nonce for replay protection
        uint256 expiry; // Timestamp when order expires

        // Extended fields
        OrderType orderType; // Type of order (LIMIT, MARKET, etc.)
        TimeInForce timeInForce; // Time-in-force specification
        OrderSide side; // Buy or sell side
        uint256 stopPrice; // Stop price for stop orders (in terms of tokenGet/tokenGive ratio)
        uint256 minFillAmount; // Minimum amount that must be filled per execution
        bool allowPartialFill; // Whether partial fills are allowed
        address feeRecipient; // Address to receive trading fees (if any)
        uint256 feeAmount; // Fee amount in tokenGive
    }

    /**
     * @dev Order info stored on-chain after execution
     */
    struct OrderInfo {
        bytes32 orderHash; // Hash of the order
        address maker; // Maker address
        uint256 filledAmount; // Amount already filled
        uint256 remainingAmount; // Amount remaining to be filled
        OrderStatus status; // Current status of the order
        uint256 createdAt; // Timestamp when order was first executed
        uint256 lastUpdatedAt; // Timestamp of last update
    }

    // ============ State Variables ============

    // EIP-712 TypeHash for extended Order struct
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address tokenGet,uint256 amountGet,address tokenGive,uint256 amountGive,uint256 nonce,uint256 expiry,uint8 orderType,uint8 timeInForce,uint8 side,uint256 stopPrice,uint256 minFillAmount,bool allowPartialFill,address feeRecipient,uint256 feeAmount)"
    );

    // User balances: user => token => amount
    mapping(address => mapping(address => uint256)) public balances;

    // Order info: orderHash => OrderInfo
    mapping(bytes32 => OrderInfo) public orderInfos;

    // Filled amounts for each order: orderHash => filledAmount
    mapping(bytes32 => uint256) public filled;

    // Cancelled orders: orderHash => isCancelled
    mapping(bytes32 => bool) public cancelled;

    // User nonces: user => nonce
    mapping(address => uint256) public nonces;

    // Stop orders waiting to be triggered: stopPrice => orderHash[]
    mapping(uint256 => bytes32[]) public stopOrders;

    // Current market price for each token pair: tokenA => tokenB => price
    // Price is represented as (tokenB amount * 1e18) / tokenA amount
    mapping(address => mapping(address => uint256)) public marketPrices;

    // Fee collector address
    address public feeCollector;

    // Trading fee (in basis points, e.g., 30 = 0.3%). Defaults to 0 for backward compatibility.
    uint256 public tradingFeeBps;

    // ============ Events ============

    event Deposit(address indexed user, address indexed token, uint256 amount, uint256 balance);
    event Withdraw(address indexed user, address indexed token, uint256 amount, uint256 balance);

    event OrderCreated(
        bytes32 indexed orderHash,
        address indexed maker,
        OrderType orderType,
        TimeInForce timeInForce,
        OrderSide side
    );

    event OrderExecuted(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        address tokenGet,
        uint256 amountGet,
        address tokenGive,
        uint256 amountGive,
        uint256 fillAmount,
        uint256 feeAmount,
        uint256 timestamp
    );

    event OrderCancelled(bytes32 indexed orderHash, address indexed maker, string reason);
    event OrderStatusChanged(bytes32 indexed orderHash, OrderStatus oldStatus, OrderStatus newStatus);
    event StopOrderTriggered(bytes32 indexed orderHash, uint256 triggerPrice);
    event MarketPriceUpdated(address indexed tokenA, address indexed tokenB, uint256 newPrice);
    event NonceIncremented(address indexed user, uint256 newNonce);
    event TradingFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);

    // ============ Constructor ============

    constructor() EIP712("DEX", "1") {
        feeCollector = msg.sender;
        tradingFeeBps = 0;
    }

    // ============ Deposit & Withdraw Functions ============

    function deposit(address token, uint256 amount) external nonReentrant {
        require(token != address(0), "DEX: Invalid token address");
        require(amount > 0, "DEX: Amount must be greater than 0");

        require(
            IERC20(token).transferFrom(msg.sender, address(this), amount),
            "DEX: Transfer failed"
        );

        balances[msg.sender][token] += amount;
        emit Deposit(msg.sender, token, amount, balances[msg.sender][token]);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        require(token != address(0), "DEX: Invalid token address");
        require(amount > 0, "DEX: Amount must be greater than 0");
        require(balances[msg.sender][token] >= amount, "DEX: Insufficient balance");

        balances[msg.sender][token] -= amount;

        require(IERC20(token).transfer(msg.sender, amount), "DEX: Transfer failed");
        emit Withdraw(msg.sender, token, amount, balances[msg.sender][token]);
    }

    function balanceOf(address user, address token) external view returns (uint256) {
        return balances[user][token];
    }

    // ============ Order Hash & Verification ============

    /**
     * @dev Calculate the hash of an extended order using EIP-712
     */
    function getOrderHash(Order memory order) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    order.maker,
                    order.tokenGet,
                    order.amountGet,
                    order.tokenGive,
                    order.amountGive,
                    order.nonce,
                    order.expiry,
                    order.orderType,
                    order.timeInForce,
                    order.side,
                    order.stopPrice,
                    order.minFillAmount,
                    order.allowPartialFill,
                    order.feeRecipient,
                    order.feeAmount
                )
            )
        );
    }

    /**
     * @dev Verify the signature of an order
     */
    function verifyOrder(Order memory order, bytes memory signature) public view returns (bool) {
        bytes32 orderHash = getOrderHash(order);
        address signer = orderHash.recover(signature);
        return signer == order.maker;
    }

    /**
     * @dev Check if an order is valid
     */
    function isOrderValid(Order memory order) public view returns (bool) {
        bytes32 orderHash = getOrderHash(order);

        if (cancelled[orderHash]) return false;
        if (block.timestamp > order.expiry) return false;
        if (order.nonce < nonces[order.maker]) return false;
        if (!order.allowPartialFill && filled[orderHash] > 0) return false;

        return true;
    }

    /**
     * @dev Check if stop order should be triggered
     */
    function shouldTriggerStopOrder(Order memory order) public view returns (bool) {
        if (order.orderType != OrderType.STOP_LOSS && order.orderType != OrderType.STOP_LIMIT) {
            return false;
        }

        uint256 currentPrice = marketPrices[order.tokenGive][order.tokenGet];
        if (currentPrice == 0) return false;

        if (order.side == OrderSide.SELL) {
            return currentPrice <= order.stopPrice;
        } else {
            return currentPrice >= order.stopPrice;
        }
    }

    // ============ Order Execution ============

    function executeOrder(
        Order memory order,
        bytes memory signature,
        uint256 fillAmount
    ) external nonReentrant {
        _executeOrder(order, signature, fillAmount, false);
    }

    function executeMarketOrder(
        Order memory order,
        bytes memory signature,
        uint256 maxSlippage
    ) external nonReentrant {
        require(order.orderType == OrderType.MARKET, "DEX: Not a market order");
        require(isOrderValid(order), "DEX: Order is not valid");
        require(verifyOrder(order, signature), "DEX: Invalid signature");

        uint256 currentPrice = marketPrices[order.tokenGive][order.tokenGet];
        require(currentPrice > 0, "DEX: No market price available");

        uint256 expectedAmount = (order.amountGive * currentPrice) / 1e18;
        uint256 minAcceptableAmount = expectedAmount - ((expectedAmount * maxSlippage) / 10000);
        require(order.amountGet >= minAcceptableAmount, "DEX: Slippage too high");

        _executeOrder(order, signature, order.amountGive, true);
    }

    function _executeOrder(
        Order memory order,
        bytes memory signature,
        uint256 fillAmount,
        bool skipValidation
    ) internal {
        if (!skipValidation) {
            require(isOrderValid(order), "DEX: Order is not valid");
            require(verifyOrder(order, signature), "DEX: Invalid signature");
        }
        require(fillAmount > 0, "DEX: Fill amount must be greater than 0");

        bytes32 orderHash = getOrderHash(order);

        if (order.timeInForce == TimeInForce.POST_ONLY) {
            revert("DEX: POST_ONLY orders must be submitted through createOrder");
        }

        if (order.orderType == OrderType.STOP_LOSS || order.orderType == OrderType.STOP_LIMIT) {
            require(shouldTriggerStopOrder(order), "DEX: Stop price not reached");
            emit StopOrderTriggered(orderHash, marketPrices[order.tokenGive][order.tokenGet]);
        }

        uint256 remainingAmount = order.amountGive - filled[orderHash];
        require(remainingAmount > 0, "DEX: Order already fully filled");

        if (!order.allowPartialFill || order.timeInForce == TimeInForce.FOK) {
            require(fillAmount == remainingAmount, "DEX: Must fill entire order");
        }

        if (order.minFillAmount > 0) {
            require(fillAmount >= order.minFillAmount, "DEX: Fill amount below minimum");
        }

        if (order.timeInForce == TimeInForce.IOC) {
            if (fillAmount > remainingAmount) {
                fillAmount = remainingAmount;
            }
        } else {
            require(fillAmount <= remainingAmount, "DEX: Fill amount exceeds remaining");
        }

        require(fillAmount > 0, "DEX: Fill amount must be positive");

        uint256 getAmount = (fillAmount * order.amountGet) / order.amountGive;

        uint256 feeAmount = (fillAmount * tradingFeeBps) / 10000;
        if (order.feeAmount > 0) {
            feeAmount = (fillAmount * order.feeAmount) / order.amountGive;
        }

        require(
            balances[order.maker][order.tokenGive] >= fillAmount,
            "DEX: Maker has insufficient balance"
        );
        require(
            balances[msg.sender][order.tokenGet] >= getAmount,
            "DEX: Taker has insufficient balance"
        );

        filled[orderHash] += fillAmount;

        OrderInfo storage info = orderInfos[orderHash];
        OrderStatus oldStatus = info.status;

        if (info.orderHash == bytes32(0)) {
            info.orderHash = orderHash;
            info.maker = order.maker;
            info.filledAmount = fillAmount;
            info.remainingAmount = order.amountGive - fillAmount;
            info.status = info.remainingAmount == 0 ? OrderStatus.FILLED : OrderStatus.PARTIAL;
            info.createdAt = block.timestamp;
        } else {
            info.filledAmount += fillAmount;
            info.remainingAmount -= fillAmount;
            info.status = info.remainingAmount == 0 ? OrderStatus.FILLED : OrderStatus.PARTIAL;
        }
        info.lastUpdatedAt = block.timestamp;

        if (oldStatus != info.status) {
            emit OrderStatusChanged(orderHash, oldStatus, info.status);
        }

        balances[order.maker][order.tokenGive] -= fillAmount;
        balances[order.maker][order.tokenGet] += getAmount;
        balances[msg.sender][order.tokenGet] -= getAmount;
        balances[msg.sender][order.tokenGive] += (fillAmount - feeAmount);

        address feeRecipient = order.feeRecipient != address(0) ? order.feeRecipient : feeCollector;
        if (feeAmount > 0) {
            balances[feeRecipient][order.tokenGive] += feeAmount;
        }

        uint256 executionPrice = (getAmount * 1e18) / fillAmount;
        marketPrices[order.tokenGive][order.tokenGet] = executionPrice;
        marketPrices[order.tokenGet][order.tokenGive] = (fillAmount * 1e18) / getAmount;
        emit MarketPriceUpdated(order.tokenGive, order.tokenGet, executionPrice);

        emit OrderExecuted(
            orderHash,
            order.maker,
            msg.sender,
            order.tokenGet,
            getAmount,
            order.tokenGive,
            fillAmount,
            fillAmount,
            feeAmount,
            block.timestamp
        );
    }

    // ============ Order Cancellation ============

    function cancelOrder(Order memory order) external {
        require(msg.sender == order.maker, "DEX: Only maker can cancel order");

        bytes32 orderHash = getOrderHash(order);
        require(!cancelled[orderHash], "DEX: Order already cancelled");

        cancelled[orderHash] = true;

        OrderInfo storage info = orderInfos[orderHash];
        OrderStatus oldStatus = info.status;
        if (info.orderHash != bytes32(0)) {
            info.status = OrderStatus.CANCELLED;
            info.lastUpdatedAt = block.timestamp;
            if (oldStatus != info.status) {
                emit OrderStatusChanged(orderHash, oldStatus, info.status);
            }
        }

        emit OrderCancelled(orderHash, order.maker, "Cancelled by maker");
    }

    function cancelOrders(Order[] memory orders) external {
        for (uint256 i = 0; i < orders.length; i++) {
            require(msg.sender == orders[i].maker, "DEX: Only maker can cancel order");

            bytes32 orderHash = getOrderHash(orders[i]);

            if (!cancelled[orderHash]) {
                cancelled[orderHash] = true;

                OrderInfo storage info = orderInfos[orderHash];
                OrderStatus oldStatus = info.status;
                if (info.orderHash != bytes32(0)) {
                    info.status = OrderStatus.CANCELLED;
                    info.lastUpdatedAt = block.timestamp;
                    if (oldStatus != info.status) {
                        emit OrderStatusChanged(orderHash, oldStatus, info.status);
                    }
                }

                emit OrderCancelled(orderHash, orders[i].maker, "Batch cancelled");
            }
        }
    }

    function incrementNonce() external {
        nonces[msg.sender] += 1;
        emit NonceIncremented(msg.sender, nonces[msg.sender]);
    }

    // ============ View Functions ============

    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    function getFilledAmount(bytes32 orderHash) external view returns (uint256) {
        return filled[orderHash];
    }

    function isCancelled(bytes32 orderHash) external view returns (bool) {
        return cancelled[orderHash];
    }

    function getOrderInfo(bytes32 orderHash) external view returns (OrderInfo memory) {
        return orderInfos[orderHash];
    }

    function getRemainingAmount(Order memory order) external view returns (uint256) {
        if (!isOrderValid(order)) return 0;

        bytes32 orderHash = getOrderHash(order);
        uint256 filledAmount = filled[orderHash];

        if (filledAmount >= order.amountGive) return 0;

        return order.amountGive - filledAmount;
    }

    function getMarketPrice(address tokenA, address tokenB) external view returns (uint256) {
        return marketPrices[tokenA][tokenB];
    }

    // ============ Admin Functions ============

    function setTradingFee(uint256 newFeeBps) external {
        require(msg.sender == feeCollector, "DEX: Only fee collector");
        require(newFeeBps <= 1000, "DEX: Fee too high");

        uint256 oldFee = tradingFeeBps;
        tradingFeeBps = newFeeBps;

        emit TradingFeeUpdated(oldFee, newFeeBps);
    }

    function setFeeCollector(address newCollector) external {
        require(msg.sender == feeCollector, "DEX: Only fee collector");
        require(newCollector != address(0), "DEX: Invalid address");
        feeCollector = newCollector;
    }
}
