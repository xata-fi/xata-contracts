// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

// Based on SNX's StakingRewards.sol https://github.com/Synthetixio/synthetix/blob/v2.52.0-alpha/contracts/StakingRewards.sol, updated for sol 0.8.0
/// @title A RewardPool holds reward tokens and allow stakers of a chosen ERC-20 token to claim rewards for staking over a period of time.
contract MultiRewardPool is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    /* ========== STATE VARIABLES ========== */

    struct Reward {
        address rewardsDistributor;
        uint256 rewardsDuration;
        uint256 periodFinish;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
    }

    IERC20 public stakingToken;
    mapping(address => Reward) public rewardData;
    address[] public rewardTokens;

    // user -> reward token -> amount
    mapping(address => mapping(address => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(address => uint256)) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    /* ========== CONSTRUCTOR ========== */

    constructor(address _stakingToken) {
        stakingToken = IERC20(_stakingToken);
    }

    function addReward(
        address _rewardsToken,
        address _rewardsDistributor,
        uint256 _rewardsDuration
    ) public onlyOwner {
        require(rewardData[_rewardsToken].rewardsDuration == 0);
        rewardTokens.push(_rewardsToken);
        rewardData[_rewardsToken].rewardsDistributor = _rewardsDistributor;
        rewardData[_rewardsToken].rewardsDuration = _rewardsDuration;
    }

    /* ========== VIEWS ========== */
    /// @notice Total staked tokens in pool.
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    /// @notice Number of staked token target account has, in the pool.
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /// @notice Returns the last timestamp(in the past) when rewards were applicable.
    /// @dev Obtains the last timestamp where rewards were applicable
    function lastTimeRewardApplicable(address _rewardsToken) public view returns (uint256) {
        return Math.min(block.timestamp, rewardData[_rewardsToken].periodFinish);
    }

    /// @notice Calculates the latest rate for # rewardTokensIssued per staked LP token. Multipled by 1e18.
    function rewardPerToken(address _rewardsToken) public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardData[_rewardsToken].rewardPerTokenStored;
        }
        return
            rewardData[_rewardsToken].rewardPerTokenStored +
            (((lastTimeRewardApplicable(_rewardsToken) - rewardData[_rewardsToken].lastUpdateTime) *
                rewardData[_rewardsToken].rewardRate *
                1e18) / _totalSupply);
    }

    /// @notice Calculate total accumulated reward tokens for this account thus far.
    /// @param account Account to check.
    /// @param _rewardsToken Specific reward token address.
    /// @return # of claimable reward tokens for the given account.
    function earned(address account, address _rewardsToken) public view returns (uint256) {
        return
            (_balances[account] * (rewardPerToken(_rewardsToken) - userRewardPerTokenPaid[account][_rewardsToken])) /
            1e18 +
            rewards[account][_rewardsToken];
    }

    /// @notice Total number of reward tokens to be given out for the entire reward duration
    function getRewardForDuration(address _rewardsToken) external view returns (uint256) {
        return rewardData[_rewardsToken].rewardRate * rewardData[_rewardsToken].rewardsDuration;
    }

    /// @notice List of all reward token addresses
    function getAllRewardTokens() public view returns (address[] memory) {
        return rewardTokens;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function setRewardsDistributor(address _rewardsToken, address _rewardsDistributor) external onlyOwner {
        rewardData[_rewardsToken].rewardsDistributor = _rewardsDistributor;
    }

    /// @notice Stake LP tokens into the pool to start receiving rewards. Called by user. Ensure that user already approved this contract on the staked LP's token contract before calling.
    function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply = _totalSupply + amount;
        _balances[msg.sender] = _balances[msg.sender] + amount;
        emit Staked(msg.sender, amount);
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Unstake LP tokens from the pool.
    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply = _totalSupply - amount;
        _balances[msg.sender] = _balances[msg.sender] - amount;
        emit Withdrawn(msg.sender, amount);
        stakingToken.safeTransfer(msg.sender, amount);
    }

    /// @notice Transfers earned rewards to msg.sender
    function getReward() public nonReentrant updateReward(msg.sender) {
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            address _rewardsToken = rewardTokens[i];
            uint256 reward = rewards[msg.sender][_rewardsToken];
            if (reward > 0) {
                rewards[msg.sender][_rewardsToken] = 0;
                emit RewardPaid(msg.sender, _rewardsToken, reward);
                IERC20(_rewardsToken).safeTransfer(msg.sender, reward);
            }
        }
    }

    // @dev Ignored slither detector because the only function calls, withdraw() and getReward(), are both marked with `nonReentrant` modifiers. Since the reentrant status is shared on the entire contract, either of the function calls should be unable to perform a successful reentrant attack.
    //slither-disable-next-line reentrancy-eth
    function exit() external {
        withdraw(_balances[msg.sender]);
        getReward();
    }

    /* ========== RESTRICTED FUNCTIONS ========== */
    /// @notice Not for use in UI. Call once after reward tokens have been received by this contract correctly. This will start the reward duration. It is possible to stake LP tokens ahead of time.
    /// @param _rewardsToken token address of the reward token
    /// @param reward Quantity of reward to be added the amount that needs to be distributed. Should not be more than what was topped up.
    function notifyRewardAmount(address _rewardsToken, uint256 reward) external updateReward(address(0)) {
        // Checks
        require(
            rewardData[_rewardsToken].rewardsDistributor == msg.sender,
            "Caller not reward distributor for this token."
        );

        // Effects
        if (block.timestamp >= rewardData[_rewardsToken].periodFinish) {
            rewardData[_rewardsToken].rewardRate = reward / rewardData[_rewardsToken].rewardsDuration;
        } else {
            uint256 remaining = rewardData[_rewardsToken].periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardData[_rewardsToken].rewardRate;
            rewardData[_rewardsToken].rewardRate = (reward + leftover) / rewardData[_rewardsToken].rewardsDuration;
        }

        rewardData[_rewardsToken].lastUpdateTime = block.timestamp;
        rewardData[_rewardsToken].periodFinish = block.timestamp + rewardData[_rewardsToken].rewardsDuration;

        emit RewardAdded(reward);
        // handle the transfer of reward tokens via `transferFrom` to reduce the number
        // of transactions required and ensure correctness of the reward amount
        // Interactions
        IERC20(_rewardsToken).safeTransferFrom(msg.sender, address(this), reward);
    }

    /// @notice Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    function recoverERC20(address tokenAddress, uint256 tokenAmount) external onlyOwner {
        require(tokenAddress != address(stakingToken), "Cannot withdraw the staking token");
        emit Recovered(tokenAddress, tokenAmount);
        IERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
    }

    /// @notice Call after reward duration is finished, and pool is inactive. Sets the next reward duration. Only callable by rewardDistributor for specific token
    function setRewardsDuration(address _rewardsToken, uint256 _rewardsDuration) external {
        require(block.timestamp > rewardData[_rewardsToken].periodFinish, "Reward period still active");
        require(
            rewardData[_rewardsToken].rewardsDistributor == msg.sender,
            "Caller not reward distributor for this token."
        );
        require(_rewardsDuration > 0, "Reward duration must be non-zero");
        rewardData[_rewardsToken].rewardsDuration = _rewardsDuration;
        emit RewardsDurationUpdated(_rewardsToken, rewardData[_rewardsToken].rewardsDuration);
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
        for (uint256 i; i < rewardTokens.length; i++) {
            address token = rewardTokens[i];
            rewardData[token].rewardPerTokenStored = rewardPerToken(token);
            rewardData[token].lastUpdateTime = lastTimeRewardApplicable(token);
            if (account != address(0)) {
                rewards[account][token] = earned(account, token);
                userRewardPerTokenPaid[account][token] = rewardData[token].rewardPerTokenStored;
            }
        }
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, address indexed rewardsToken, uint256 reward);
    event RewardsDurationUpdated(address token, uint256 newDuration);
    event Recovered(address token, uint256 amount);
}
