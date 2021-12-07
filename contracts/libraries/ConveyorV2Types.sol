// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

library ConveyorV2Types {
    /**
     * @param tokenA: address of the ERC20 token <A>
     * @param tokenB: address of the ERC20 token <B>
     * @param amountADesired: the amount of token A the sender is willing to provide
     * @param amountBDesired: the amount of token B the sender is willing to provide
     * @param amountAMin: the minimum amount of token A the sender must provide
     * @param amountBMin: the minimum amount of token B the sender must provide
     * @param user: sender and LP Token recipient address
     * @param deadline: Unix timestamp after which the transaction will revert
     */
    struct ADDLIQUIDITY_TYPE {
        address tokenA;
        address tokenB;
        uint256 amountADesired;
        uint256 amountBDesired;
        uint256 amountAMin;
        uint256 amountBMin;
        address user;
        uint256 deadline;
    }

    /**
     * @param amount0
     * @param amount1
     * @param path: the array of token addresses
     * @param user: user address
     * @param deadline: Unix timestamp after which the transaction will revert
     */
    struct SWAP_TYPE {
        uint256 amount0;
        uint256 amount1;
        address[] path;
        address user;
        uint256 deadline;
    }

    /**
     * @param tokenA: address of the ERC20 token <A>
     * @param tokenB: address of the ERC20 token <B>
     * @param amountAMin: the minimum amount of token A the sender must provide
     * @param amountBMin: the minimum amount of token B the sender must provide
     * @param user: sender and LP Token recipient address
     * @param deadline: Unix timestamp after which the transaction will revert
     */
    struct REMOVELIQUIDITY_TYPE {
        address tokenA;
        address tokenB;
        uint256 liquidity;
        uint256 amountAMin;
        uint256 amountBMin;
        address user;
        uint256 deadline;
    }

    struct SIGNATURE_TYPE {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
}
