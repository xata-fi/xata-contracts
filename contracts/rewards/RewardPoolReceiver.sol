// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./RewardPool.sol";
import "../interfaces/IRewardPool.sol";

/// @title Staging contract to receive reward tokens before starting and funding a rewardPool.
/// @notice After instantiating the receiver, dev team will call the 'createRewardPool' function. External teams can then fund the contract with a reward token. And finally, we can call 'sendRewardsToRewardPool' if everything looks ok.
contract RewardPoolReceiver is Ownable {
    using SafeERC20 for IERC20;

    address public lead;
    address public dev;
    address public token;
    address public rewardPool;

    uint256 public fee; // 50 = 5%
    uint256 public constant FEE_MAX = 1000;

    event RewardPoolCreated(address rewardPool);

    modifier onlyManager() {
        require(msg.sender == lead || msg.sender == dev || msg.sender == owner(), "!manager");
        _;
    }

    constructor(
        address _lead,
        address _dev,
        address _token,
        uint256 _fee
    ) {
        lead = _lead;
        dev = _dev;
        token = _token;
        fee = _fee;
    }

    function setDev(address _dev) external onlyManager {
        dev = _dev;
    }

    /// @notice Called to create the rewardpool and obtain the rewardpool address.
    function createRewardPool(address _stakedToken, uint8 _durationDays) external onlyManager {
        _createRewardPool(_stakedToken, token, _durationDays);
    }

    function _createRewardPool(
        address _stakedToken,
        address _rewardToken,
        uint8 _durationDays
    ) internal {
        require(rewardPool == address(0), "rewardpool already set");

        uint256 duration = 3600 * 24 * _durationDays;
        RewardPool newRewardPool = new RewardPool(_rewardToken, _stakedToken, duration);
        newRewardPool.setRewardsDistribution(dev);
        newRewardPool.transferOwnership(owner());

        rewardPool = address(newRewardPool);
        emit RewardPoolCreated(rewardPool);
    }

    /// @notice Call after verifying that reward token address and qty is correct. This will forward the reward tokens to the rewardpool.
    function sendRewardsToRewardPool() external onlyOwner {
        require(rewardPool != address(0), "!rewardpool");
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "no rewards");

        uint256 feeAmount = (bal * fee) / FEE_MAX;
        IERC20(token).safeTransfer(lead, feeAmount);

        address rewardToken = IRewardPool(rewardPool).rewardsTokenAddress();

        uint256 rewardBal = IERC20(rewardToken).balanceOf(address(this));
        IERC20(rewardToken).safeTransfer(rewardPool, rewardBal);
    }

    /// @notice Withdraw reward tokens to owner's address.
    function recoverRewards() external onlyManager {
        recover(token);
    }

    /// @notice Withdraw all of target token to owner's address.
    function recover(address _token) public onlyManager {
        uint256 bal = IERC20(_token).balanceOf(address(this));
        recover(_token, bal);
    }

    /// @notice Withdraw a specific token and amount to owner's address.
    function recover(address _token, uint256 _amount) public onlyManager {
        IERC20(_token).safeTransfer(owner(), _amount);
    }
}
