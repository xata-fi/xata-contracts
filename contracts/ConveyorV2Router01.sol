// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./interfaces/IConveyorV2Factory.sol";
import "./libraries/TransferHelper.sol";
import "./libraries/ConveyorV2Library.sol";
import "./interfaces/IConveyorV2Router01.sol";
import "./utils/ERC20Forwarder.sol";

contract ConveyorV2Router01 is IConveyorV2Router01, ERC20Forwarder {
    // **** RELAYER ****
    // Keeps track of authorized function callers (Geode)
    bool public metaEnabled = true;

    // **** CONSTANTS ****
    address public immutable override factory;

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "ConveyorV2Router: EXPIRED");
        _;
    }

    constructor(address _factory) {
        factory = _factory;
    }

    // **** ADMIN ****

    modifier metaOnly() {
        if (metaEnabled) {
            require(msg.sender == address(this), "ConveyorV2Router: FORBIDDEN! Meta only");
        }
        _;
    }

    function metaSwitch() public onlyOwner {
        metaEnabled = !metaEnabled;
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) private returns (uint256 amountA, uint256 amountB) {
        // create the pair if it doesn't exist yet
        if (IConveyorV2Factory(factory).getPair(tokenA, tokenB) == address(0)) {
            IConveyorV2Factory(factory).createPair(tokenA, tokenB);
        }
        (uint256 reserveA, uint256 reserveB) = ConveyorV2Library.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = ConveyorV2Library.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "ConveyorV2Router: INSUFFICIENT_B_AMOUNT");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = ConveyorV2Library.quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, "ConveyorV2Router: INSUFFICIENT_A_AMOUNT");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function addLiquidity(ConveyorV2Types.ADDLIQUIDITY_TYPE memory al)
        external
        override
        ensure(al.deadline)
        metaOnly
        returns (
            uint256 amountA,
            uint256 amountB,
            uint256 liquidity
        )
    {
        require(msgSender() == al.user, "ConveyorV2Router: Sender does not match token recipient");
        (amountA, amountB) = _addLiquidity(
            al.tokenA,
            al.tokenB,
            al.amountADesired,
            al.amountBDesired,
            al.amountAMin,
            al.amountBMin
        );
        address pair = ConveyorV2Library.pairFor(factory, al.tokenA, al.tokenB);
        {
            // scope for verifying transfer amounts
            uint256 pairBalanceA = IERC20(al.tokenA).balanceOf(pair);
            uint256 pairBalanceB = IERC20(al.tokenB).balanceOf(pair);
            TransferHelper.safeTransferFrom(al.tokenA, msgSender(), pair, amountA);
            TransferHelper.safeTransferFrom(al.tokenB, msgSender(), pair, amountB);
            require(
                ((IERC20(al.tokenA).balanceOf(pair) - pairBalanceA == amountA) &&
                    (IERC20(al.tokenB).balanceOf(pair) - pairBalanceB == amountB)),
                "ConveyorV2Router01: Transfer amount does not match input amount"
            );
        }
        liquidity = IConveyorV2Pair(pair).mint(msgSender());
    }

    // **** REMOVE LIQUIDITY ****
    function removeLiquidityWithPermit(
        ConveyorV2Types.REMOVELIQUIDITY_TYPE memory rl,
        ConveyorV2Types.SIGNATURE_TYPE memory sig
    ) public override ensure(rl.deadline) metaOnly returns (uint256 amountA, uint256 amountB) {
        require(msgSender() == rl.user, "ConveyorV2Router: Sender does not match token recipient");
        address pair = ConveyorV2Library.pairFor(factory, rl.tokenA, rl.tokenB);
        IConveyorV2Pair(pair).permit(msgSender(), address(this), rl.liquidity, rl.deadline, sig.v, sig.r, sig.s);
        IConveyorV2Pair(pair).transferFrom(msgSender(), pair, rl.liquidity); // send liquidity to pair
        (uint256 amount0, uint256 amount1) = IConveyorV2Pair(pair).burn(msgSender());
        (address token0, ) = ConveyorV2Library.sortTokens(rl.tokenA, rl.tokenB);
        (amountA, amountB) = rl.tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= rl.amountAMin, "ConveyorV2Router: INSUFFICIENT_A_AMOUNT");
        require(amountB >= rl.amountBMin, "ConveyorV2Router: INSUFFICIENT_B_AMOUNT");
    }

    // **** SWAP ****
    // requires the initial amount to have already been sent to the first pair
    function _swap(
        uint256[] memory amounts,
        address[] memory path,
        address _to
    ) private {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0, ) = ConveyorV2Library.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0
                ? (uint256(0), amountOut)
                : (amountOut, uint256(0));
            address to = i < path.length - 2 ? ConveyorV2Library.pairFor(factory, output, path[i + 2]) : _to;
            IConveyorV2Pair(ConveyorV2Library.pairFor(factory, input, output)).swap(
                amount0Out,
                amount1Out,
                to,
                new bytes(0)
            );
        }
    }

    function swapExactTokensForTokens(ConveyorV2Types.SWAP_TYPE memory swap)
        external
        override
        ensure(swap.deadline)
        metaOnly
        returns (uint256[] memory amounts)
    {
        require(msgSender() == swap.user, "ConveyorV2Router: Sender does not match token recipient");
        amounts = ConveyorV2Library.getAmountsOut(factory, swap.amount0, swap.path);
        require(amounts[amounts.length - 1] >= swap.amount1, "ConveyorV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        TransferHelper.safeTransferFrom(
            swap.path[0],
            msgSender(),
            ConveyorV2Library.pairFor(factory, swap.path[0], swap.path[1]),
            amounts[0]
        );
        {
            // output amount and balance check
            uint256 outBalanceBefore = IERC20(swap.path[swap.path.length - 1]).balanceOf(msgSender());
            _swap(amounts, swap.path, msgSender());
            require(
                IERC20(swap.path[swap.path.length - 1]).balanceOf(msgSender()) ==
                    outBalanceBefore + amounts[amounts.length - 1],
                "ConveyorV2Router01: Transfer amount does not match output amount"
            );
        }
    }

    function swapTokensForExactTokens(ConveyorV2Types.SWAP_TYPE memory swap)
        external
        override
        ensure(swap.deadline)
        metaOnly
        returns (uint256[] memory amounts)
    {
        require(msgSender() == swap.user, "ConveyorV2Router: Sender does not match token recipient");
        amounts = ConveyorV2Library.getAmountsIn(factory, swap.amount0, swap.path);
        require(amounts[0] <= swap.amount1, "ConveyorV2Router: EXCESSIVE_INPUT_AMOUNT");
        TransferHelper.safeTransferFrom(
            swap.path[0],
            msgSender(),
            ConveyorV2Library.pairFor(factory, swap.path[0], swap.path[1]),
            amounts[0]
        );
        {
            // output amount and balance check
            uint256 outBalanceBefore = IERC20(swap.path[swap.path.length - 1]).balanceOf(msgSender());
            _swap(amounts, swap.path, msgSender());
            require(
                IERC20(swap.path[swap.path.length - 1]).balanceOf(msgSender()) ==
                    outBalanceBefore + amounts[amounts.length - 1],
                "ConveyorV2Router01: Transfer amount does not match output amount"
            );
        }
    }

    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) public pure override returns (uint256 amountB) {
        return ConveyorV2Library.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure override returns (uint256 amountOut) {
        return ConveyorV2Library.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure override returns (uint256 amountIn) {
        return ConveyorV2Library.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint256 amountIn, address[] memory path)
        public
        view
        override
        returns (uint256[] memory amounts)
    {
        return ConveyorV2Library.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint256 amountOut, address[] memory path)
        public
        view
        override
        returns (uint256[] memory amounts)
    {
        return ConveyorV2Library.getAmountsIn(factory, amountOut, path);
    }
}
