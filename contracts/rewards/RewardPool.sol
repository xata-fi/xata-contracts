// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Inheritance
import "../interfaces/IRewardPool.sol";
import "./RewardsDistributionRecipient.sol";

/// @title A RewardPool holds reward tokens and allow stakers of a chosen ERC-20 token to claim rewards for staking over a period of time.
contract RewardPool is IRewardPool, RewardsDistributionRecipient, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    IERC20 public rewardsToken;
    IERC20 public stakingToken;
    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;
    uint256 public rewardsDuration = 0;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address _rewardsToken,
        address _stakingToken,
        uint256 _durationInSeconds
    ) {
        rewardsToken = IERC20(_rewardsToken);
        stakingToken = IERC20(_stakingToken);
        rewardsDuration = _durationInSeconds;
    }

    /* ========== VIEWS ========== */
    /// @notice Total staked tokens in pool.
    function totalSupply() external view override returns (uint256) {
        return _totalSupply;
    }

    /// @notice Number of staked token target account has, in the pool.
    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    /// @notice Returns the last timestamp(in the past) when rewards were applicable.
    /// @dev Obtains the last timestamp where rewards were applicable
    function lastTimeRewardApplicable() public view override returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    /// @notice Calculates the latest rate for # rewardTokensIssued per staked LP token. Multipled by 1e18.
    function rewardPerToken() public view override returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }
        return
            rewardPerTokenStored + (((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / _totalSupply);
    }

    /// @notice Calculate total accumulated reward tokens for this account thus far.
    /// @param account Account to check.
    /// @return # of claimable reward tokens for the given account.
    function earned(address account) public view override returns (uint256) {
        return (_balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18 + rewards[account];
    }

    /// @notice Total number of reward tokens to be given out for the entire reward duration
    function getRewardForDuration() external view override returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    function rewardsTokenAddress() external view override returns (address) {
        return address(rewardsToken);
    }

    function stakingTokenAddress() external view override returns (address) {
        return address(stakingToken);
    }

    /// @dev Address of the account that can control reward distribution -> call notifyReward. This role is given to dev team for now.
    function rewardsDistributionAddress() external view override returns (address) {
        return rewardsDistribution;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    /// @notice Stake LP tokens into the pool to start receiving rewards. Called by user. Ensure that user already approved this contract on the staked LP's token contract before calling.
    function stake(uint256 amount) external override nonReentrant whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply + amount;
        _balances[msg.sender] = _balances[msg.sender] + amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /// @notice Unstake LP tokens from the pool.
    function withdraw(uint256 amount) public override nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply = _totalSupply - amount;
        _balances[msg.sender] = _balances[msg.sender] - amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Transfers earned rewards to msg.sender
    function getReward() public override nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;

            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    // @dev Ignored slither detector because the only function calls, withdraw() and getReward(), are both marked with `nonReentrant` modifiers. Since the reentrant status is shared on the entire contract, either of the function calls should be unable to perform a successful reentrant attack.
    //slither-disable-next-line reentrancy-eth
    function exit() external override {
        withdraw(_balances[msg.sender]);
        getReward();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */
    /// @notice Not for use in UI. Call once after reward tokens have been received by this contract correctly. This will start the reward duration. It is possible to stake LP tokens ahead of time.
    /// @param reward Quantity of reward to be added the amount that needs to be distributed. Should not be more than what was topped up.
    function notifyRewardAmount(uint256 reward) external override onlyRewardsDistribution updateReward(address(0)) {
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = rewardsToken.balanceOf(address(this));
        require(rewardRate <= balance / rewardsDuration, "Provided reward too high");

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(reward);
    }

    /// @notice Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(stakingToken), "Cannot withdraw the staking token");
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    /// @notice Call after reward duration is finished, and pool is inactive. Sets the next reward duration.
    function setRewardsDuration(uint256 _rewardsDuration) external onlyOwner {
        require(
            block.timestamp > periodFinish,
            "Previous rewards period must be complete before changing the duration for the new period"
        );
        rewardsDuration = _rewardsDuration;
        emit RewardsDurationUpdated(rewardsDuration);
    }

    /// @notice Pauses staking.
    function _pause() internal override whenNotPaused onlyOwner {
        super._pause();
    }

    /// @notice Unpauses staking.
    function _unpause() internal override whenPaused onlyOwner {
        super._unpause();
    }

    /* ========== MODIFIERS ========== */

    /// @dev Updates the checkpoint for rewardPerTokenStored, and the rewards accrued by current msg.sender
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDurationUpdated(uint256 newDuration);
    event Recovered(address token, uint256 amount);
}
