// This Contract serves as a "helper" contract to deploy ConveyorV2 contracts using CREATE2
// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Deployer is Ownable {
    event ContractDeployed(address addr);

    /**
     * @dev Performs a function call to the target contract.
     * @param implementation the contract to call
     * @param data the encoded function data
     */
    function functionCall(address implementation, bytes calldata callData)
        external
        onlyOwner
        returns (bool success, bytes memory data)
    {
        (success, data) = implementation.call(callData);
        require(success, _getRevertMsg(data));
    }

    /**
     * @dev Deploys a contract using `CREATE2`. The address where the contract
     * will be deployed can be known in advance via {computeAddress}.
     *
     * The bytecode for a contract can be obtained from Solidity with
     * `type(contractName).creationCode`.
     * The bytecode can also be obtained from ethers.js contract factory with
     * ContractFactory.bytecode
     *
     *
     * @param bytecode must not be empty.
     * @param data the encoded constructor arguments. Pass in "0x0" if the constructor does not take in any values.
     * @param salt must have not been used for `bytecode` already.
     */
    function deploy(
        bytes calldata bytecode,
        bytes calldata data,
        bytes32 salt
    ) external onlyOwner returns (address) {
        address addr;
        bytes memory packedBytes = abi.encodePacked(bytecode, data);
        require(bytecode.length != 0, "Create2: bytecode length is zero");
        assembly {
            addr := create2(0, add(packedBytes, 0x20), mload(packedBytes), salt)
        }
        require(addr != address(0), "Create2: Failed on deploy");
        emit ContractDeployed(addr);
        return addr;
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via {deploy} from a contract located at
     * `deployer`. If `deployer` is this contract's address, returns the same value as {computeAddress}.
     */
    function computeAddress(
        bytes32 salt,
        bytes32 bytecodeHash,
        address deployer
    ) public pure returns (address) {
        bytes32 _data = keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, bytecodeHash));
        return address(uint160(uint256(_data)));
    }

    function withdraw(uint256 amount) external onlyOwner {
        address payable recipient = payable(msg.sender);
        recipient.transfer(amount);
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
