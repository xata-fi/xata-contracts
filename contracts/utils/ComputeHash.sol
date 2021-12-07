// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../ConveyorV2Pair.sol";

contract ComputeHash {
    function getHash() public pure returns (bytes32 h) {
        h = keccak256(type(ConveyorV2Pair).creationCode);
    }
}
