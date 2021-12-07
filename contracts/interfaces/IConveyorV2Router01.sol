// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.6.2;
pragma experimental ABIEncoderV2;

import "../libraries/ConveyorV2Types.sol";

interface IConveyorV2Router01 {
    // currently supported methods
    function factory() external view returns (address);

    function addLiquidity(ConveyorV2Types.ADDLIQUIDITY_TYPE memory al)
        external
        returns (
            uint256 amountA,
            uint256 amountB,
            uint256 liquidity
        );

    function removeLiquidityWithPermit(
        ConveyorV2Types.REMOVELIQUIDITY_TYPE memory rl,
        ConveyorV2Types.SIGNATURE_TYPE memory sig
    ) external returns (uint256 amountA, uint256 amountB);

    function swapExactTokensForTokens(ConveyorV2Types.SWAP_TYPE memory swap)
        external
        returns (uint256[] memory amounts);

    function swapTokensForExactTokens(ConveyorV2Types.SWAP_TYPE memory swap)
        external
        returns (uint256[] memory amounts);

    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) external pure returns (uint256 amountB);

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) external pure returns (uint256 amountOut);

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) external pure returns (uint256 amountIn);

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);

    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts);
}
