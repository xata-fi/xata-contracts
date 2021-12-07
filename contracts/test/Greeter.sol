//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import "../utils/ERC20Forwarder.sol";

contract Greeter is ERC20Forwarder {
    string private greeting;

    constructor(string memory _greeting, address _trustedRelayer) {
        console.log("Deploying a Greeter with greeting:", _greeting);
        greeting = _greeting;
        relayers[_trustedRelayer] = true;
    }

    function greet() public view returns (string memory) {
        return greeting;
    }

    function setGreeting(string memory _greeting) public {
        console.log("Changing greeting from '%s' to '%s'", greeting, _greeting);
        console.log("By ", msgSender());
        greeting = _greeting;
    }
}
