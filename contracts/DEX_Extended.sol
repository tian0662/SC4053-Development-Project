// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DEX.sol";

/**
 * @title DEX_Extended
 * @dev For backward compatibility. The extended functionality has been merged
 *      into the base {DEX} contract, so this contract simply inherits from it.
 */
contract DEX_Extended is DEX {}
