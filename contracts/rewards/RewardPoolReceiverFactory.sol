// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./RewardPoolReceiver.sol";

/// @title The factory to use to create reward pools.
/// @notice Using a receiver gives you more control over recovering reward tokens before the reward pools is initiated.
/// @dev This has a reward fee, and is the preferred way to create reward pools, although it may cost a little bit more gas at first.
contract RewardPoolReceiverFactory is Ownable {
    /// @dev this grants the control to recover tokens to the caller of 'createReceiver'. Should be set to an account that the dev team controls.
    address public defaultDev = address(0x1c87BfC7537BfAa397bde7D108E27819864a4e3A);
    uint256 public fee = 0; //fee will be divided by 1000, so 50 = 5%

    /// @notice
    /// @param Address of the receiver to which you can send your funds.
    event ReceiverCreated(address receiver);

    /// @notice Creates a new receiver for a given reward pool.
    /// @param token Token address for the reward pool reward token.
    /// @return Address of the receiver to which you can send your funds.
    function createReceiver(address token) external returns (address) {
        RewardPoolReceiver receiver = new RewardPoolReceiver(msg.sender, defaultDev, token, fee);
        receiver.transferOwnership(owner());
        emit ReceiverCreated(address(receiver));
        return address(receiver);
    }

    function setDefaultDev(address _dev) external onlyOwner {
        defaultDev = _dev;
    }

    function setFee(uint256 _fee) external onlyOwner {
        fee = _fee;
    }
}
