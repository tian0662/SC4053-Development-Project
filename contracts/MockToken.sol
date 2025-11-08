// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockToken
 * @dev ERC20 token contract for DEX testing purposes
 * @notice This contract creates a standard ERC20 token with minting capability
 * 
 * Features:
 * - Standard ERC20 functionality (transfer, approve, transferFrom, etc.)
 * - Minting capability for testing (owner can mint new tokens)
 * - 18 decimals by default
 * - Constructor accepts token name, symbol, and initial supply
 */
contract MockToken is ERC20, Ownable {
    
    /**
     * @dev Constructor to initialize the token
     * @param name Token name (e.g., "Test Yuan Dollar")
     * @param symbol Token symbol (e.g., "TYD")
     * @param initialSupply Initial token supply (will be minted to deployer)
     * 
     * @notice The initial supply should be specified in whole tokens (not wei)
     * @notice For example, initialSupply = 1000000 means 1,000,000 tokens
     */
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        // Mint initial supply to the contract deployer
        // The supply is automatically converted to wei (multiplied by 10^18)
        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    /**
     * @dev Mint new tokens (testing purpose only)
     * @param to Address to receive the newly minted tokens
     * @param amount Amount of tokens to mint (in whole tokens, not wei)
     * 
     * @notice Only the contract owner can call this function
     * @notice This function is useful for testing the DEX with multiple tokens
     * @notice In production, this function should be removed or heavily restricted
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount * 10 ** decimals());
    }

    /**
     * @dev Burn tokens from the caller's balance
     * @param amount Amount of tokens to burn (in whole tokens, not wei)
     * 
     * @notice Anyone can burn their own tokens
     * @notice This is useful for reducing token supply
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount * 10 ** decimals());
    }

    /**
     * @dev Returns the number of decimals used by the token
     * @return uint8 Number of decimals (18 by default)
     * 
     * @notice This function is inherited from ERC20
     * @notice Most ERC20 tokens use 18 decimals to match Ether's precision
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
