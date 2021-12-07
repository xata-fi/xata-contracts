// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.5.0;

interface IConveyorV2Callee {
    function conveyorV2Call(
        address sender,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;
}
