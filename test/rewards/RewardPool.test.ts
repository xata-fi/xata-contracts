import { ethers, network } from 'hardhat';

import { use, expect, assert } from 'chai';
import { solidity } from 'ethereum-waffle';
import { resetNetwork } from '../../lib/utils';

const DURATION = 864000;
const TIMEOUT = 10 * 60 * 1000;

use(solidity);
describe('RewardPool', async () => {
  const setup = async () => {
    await resetNetwork();
    const [signer, other] = await ethers.getSigners();

    const Token = await ethers.getContractFactory('TestToken');
    const stakedToken = await Token.deploy('10000', 'Staked Token', 'STAKED');
    const rewardToken = await Token.deploy('10000', 'Reward Token', 'REWARD');
    const otherToken = await Token.deploy('10000', 'Other Token', 'OTHER');

    const Pool = await ethers.getContractFactory('RewardPool');
    const pool = await Pool.deploy(rewardToken.address, stakedToken.address, DURATION);
    await pool.setRewardsDistribution(signer.address);

    return { signer, other, pool, stakedToken, rewardToken, otherToken };
  };

  it('initializes correctly', async () => {
    const { pool, stakedToken, rewardToken } = await setup();
    expect(await pool.stakingTokenAddress()).to.equal(stakedToken.address);
    expect(await pool.rewardsTokenAddress()).to.equal(rewardToken.address);
    expect((await pool.rewardsDuration()).eq(DURATION));
  }).timeout(TIMEOUT);

  it("should not let 'other' account withdraw stuck tokens", async () => {
    const { other, pool, otherToken } = await setup();

    const tx = pool.connect(other).recoverERC20(otherToken.address, 100);
    await expect(tx).to.be.revertedWith('Ownable: caller is not the owner');
  }).timeout(TIMEOUT);

  it("should let owner withdraw 'other' tokens", async () => {
    const { signer, pool, otherToken } = await setup();

    const bal = await otherToken.balanceOf(signer.address);

    await otherToken.transfer(pool.address, bal);
    const balOfPool = await otherToken.balanceOf(pool.address);
    await pool.recoverERC20(otherToken.address, bal);
    const balOfPoolAfter = await otherToken.balanceOf(pool.address);

    const balFinal = await otherToken.balanceOf(signer.address);

    expect(bal).to.equal(balFinal);
    expect(balOfPoolAfter).to.equal(0);
    expect(balOfPool).not.to.equal(balOfPoolAfter);
  }).timeout(TIMEOUT);

  it("should let owner withdraw 'reward' tokens before notify.", async () => {
    const { signer, pool, rewardToken } = await setup();

    const bal = await rewardToken.balanceOf(signer.address);

    await rewardToken.transfer(pool.address, bal);
    const balOfPool = await rewardToken.balanceOf(pool.address);
    await pool.recoverERC20(rewardToken.address, bal);
    const balOfPoolAfter = await rewardToken.balanceOf(pool.address);

    const balFinal = await rewardToken.balanceOf(signer.address);

    expect(bal).to.equal(balFinal);
    expect(balOfPoolAfter).to.equal(0);
    expect(balOfPool).not.to.equal(balOfPoolAfter);
  }).timeout(TIMEOUT);

  it("should not let owner withdraw 'stake' tokens", async () => {
    const { signer, pool, stakedToken, rewardToken } = await setup();

    // Fund rewards
    const bal = await rewardToken.balanceOf(signer.address);
    await rewardToken.transfer(pool.address, bal.toNumber());
    await pool.notifyRewardAmount(bal);
    // Add staking token
    await stakedToken.approve(pool.address, 5000);
    await pool.stake(5000);
    // Owner to try withdrawing
    const tx = pool.recoverERC20(stakedToken.address, 10);

    await expect(tx).to.be.revertedWith('Cannot withdraw the staking token');
  }).timeout(TIMEOUT);

  const setupEconomicTests = async () => {
    await resetNetwork();
    const [signer, staker1, staker2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory('TestToken');
    const stakedToken = await Token.deploy('10000', 'Staked Token', 'STAKED');
    const rewardToken = await Token.deploy('10000', 'Reward Token', 'REWARD');

    const Pool = await ethers.getContractFactory('RewardPool');
    const pool = await Pool.deploy(rewardToken.address, stakedToken.address, 10000);
    await pool.setRewardsDistribution(signer.address);

    // Distribute 1000 staked tokens to various stakers, and have them approve the pool.
    await stakedToken.transfer(staker1.address, 1000);
    await stakedToken.connect(staker1).approve(pool.address, 1000);
    await stakedToken.transfer(staker2.address, 1000);
    await stakedToken.connect(staker2).approve(pool.address, 1000);
    return { signer, pool, stakedToken, rewardToken, staker1, staker2 };
  };

  const evmIncreaseSeconds = async (seconds: number) => {
    await network.provider.send('evm_increaseTime', [seconds]);
    await network.provider.send('evm_mine');
  };

  const runToRewardCompletionTime = async () => {
    await network.provider.send('evm_increaseTime', [11000]);
    await network.provider.send('evm_mine');
  };

  it('issue correct rewards for stakers who staked before reward period started.', async () => {
    const { signer, pool, rewardToken, staker1, staker2 } = await setupEconomicTests();

    // users to stake their LP into a pool that hasn't started
    await pool.connect(staker1).stake(100);
    await pool.connect(staker2).stake(200);

    // Fund rewards
    const bal = await rewardToken.balanceOf(signer.address);
    await rewardToken.transfer(pool.address, bal.toNumber());
    await pool.notifyRewardAmount(bal);

    await runToRewardCompletionTime();

    // Get rewards
    let tx = await pool.connect(staker1).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');
    tx = await pool.connect(staker2).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');

    const staker1Rewards = (await rewardToken.balanceOf(staker1.address)).toNumber();
    const staker2Rewards = (await rewardToken.balanceOf(staker2.address)).toNumber();
    const rewardsRemainingInPool = await rewardToken.balanceOf(pool.address);
    assert(staker1Rewards > 0);
    assert(staker2Rewards === staker1Rewards * 2); // since staker 2 staked twice as many tokens.
    assert(staker1Rewards > rewardsRemainingInPool.toNumber()); // there should be more tokens given out than left in the pool.
  }).timeout(TIMEOUT);

  it('issue correct rewards for stakers who started staking before and after rewards started', async () => {
    const { signer, pool, rewardToken, staker1, staker2 } = await setupEconomicTests();

    // users to stake their LP into a pool that hasn't started
    await pool.connect(staker1).stake(100);

    // Fund rewards
    const bal = await rewardToken.balanceOf(signer.address);
    await rewardToken.transfer(pool.address, bal.toNumber());
    await pool.notifyRewardAmount(bal);

    // let some time pass
    await evmIncreaseSeconds(1000);

    // another user to start staking
    await pool.connect(staker2).stake(100);

    await runToRewardCompletionTime();

    // Get rewards
    let tx = await pool.connect(staker1).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');
    tx = await pool.connect(staker2).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');

    const staker1Rewards = (await rewardToken.balanceOf(staker1.address)).toNumber();
    const staker2Rewards = (await rewardToken.balanceOf(staker2.address)).toNumber();
    assert(staker1Rewards > 0);
    assert(staker1Rewards > staker2Rewards); // staker 1 should have more tokens
    assert(staker1Rewards < staker2Rewards * 2); // but not as much as twice
  }).timeout(TIMEOUT);

  it('claiming rewards midway through time period should not affect final reward amounts.. much', async () => {
    const { signer, pool, rewardToken, staker1, staker2 } = await setupEconomicTests();

    await pool.connect(staker1).stake(100);
    await pool.connect(staker2).stake(100);

    // Fund rewards
    const bal = await rewardToken.balanceOf(signer.address);
    await rewardToken.transfer(pool.address, bal.toNumber());
    await pool.notifyRewardAmount(bal);

    // let some time pass
    await evmIncreaseSeconds(1000);

    await pool.connect(staker1).getReward();

    await runToRewardCompletionTime();

    // Get rewards
    let tx = await pool.connect(staker1).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');
    tx = await pool.connect(staker2).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');

    const staker1Rewards = (await rewardToken.balanceOf(staker1.address)).toNumber();
    const staker2Rewards = (await rewardToken.balanceOf(staker2.address)).toNumber();
    assert(staker1Rewards > 0);
    const rewardDifference = Math.abs(staker2Rewards - staker1Rewards);
    assert(rewardDifference / staker1Rewards < 0.01); // total rewards for both should be within 1% margin of error
  }).timeout(TIMEOUT);

  it('users who withdraw early will have lesser rewards', async () => {
    const { signer, pool, rewardToken, staker1, staker2 } = await setupEconomicTests();

    await pool.connect(staker1).stake(100);
    await pool.connect(staker2).stake(100);

    // Fund rewards
    const bal = await rewardToken.balanceOf(signer.address);
    await rewardToken.transfer(pool.address, bal.toNumber());
    await pool.notifyRewardAmount(bal);

    // let some time pass
    await evmIncreaseSeconds(1000);

    await pool.connect(staker1).withdraw(100);

    await runToRewardCompletionTime();

    // Get rewards
    let tx = await pool.connect(staker1).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');
    tx = await pool.connect(staker2).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');

    const staker1Rewards = (await rewardToken.balanceOf(staker1.address)).toNumber();
    const staker2Rewards = (await rewardToken.balanceOf(staker2.address)).toNumber();
    assert(staker1Rewards > 0);
    assert(staker1Rewards < staker2Rewards); // staker1 has lesser rewards because they withdrew before reward completion
  }).timeout(TIMEOUT);

  it('users who add to their stake midway will have more rewards', async () => {
    const { signer, pool, rewardToken, staker1, staker2 } = await setupEconomicTests();

    await pool.connect(staker1).stake(100);
    await pool.connect(staker2).stake(100);

    // Fund rewards
    const bal = await rewardToken.balanceOf(signer.address);
    await rewardToken.transfer(pool.address, bal.toNumber());
    await pool.notifyRewardAmount(bal);

    // let some time pass
    await evmIncreaseSeconds(2000);

    await pool.connect(staker1).stake(300);

    await runToRewardCompletionTime();

    // Get rewards
    let tx = await pool.connect(staker1).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');
    tx = await pool.connect(staker2).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');

    const staker1Rewards = (await rewardToken.balanceOf(staker1.address)).toNumber();
    const staker2Rewards = (await rewardToken.balanceOf(staker2.address)).toNumber();
    assert(staker2Rewards > 0);
    assert(staker1Rewards > staker2Rewards); // staker1 has more staked over time.
  }).timeout(TIMEOUT);

  const setupNotifyRewardTests = async () => {
    await resetNetwork();
    const [signer, other, stakingAccount1, stakingAccount2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory('TestToken');
    const stakedToken = await Token.deploy('1000000', 'Staked Token', 'STAKED');
    const rewardToken = await Token.deploy('1000000', 'Reward Token', 'REWARD');

    const Pool = await ethers.getContractFactory('RewardPool');
    const pool = await Pool.deploy(rewardToken.address, stakedToken.address, 50);
    await pool.setRewardsDistribution(signer.address);

    return { signer, other, stakingAccount1, stakingAccount2, pool, stakedToken, rewardToken };
  };

  it('Reverts if the provided reward is greater than the balance.', async () => {
    const { pool, rewardToken } = await setupNotifyRewardTests();
    const rewardValue = 10000; //this was the number
    await rewardToken.transfer(pool.address, rewardValue);
    const tx = pool.notifyRewardAmount(rewardValue + 1000);
    await expect(tx).to.be.revertedWith('Provided reward too high');
  });

  it('Reverts if the provided reward is greater than the balance, plus rolled-over balance.', async () => {
    const { pool, rewardToken } = await setupNotifyRewardTests();
    const rewardValue = 1000; //this was the number
    await rewardToken.transfer(pool.address, rewardValue);
    await pool.notifyRewardAmount(rewardValue);

    await rewardToken.transfer(pool.address, rewardValue);
    // Now take into account any leftover quantity.
    const tx = pool.notifyRewardAmount(rewardValue + 100);
    await expect(tx).to.be.revertedWith('Provided reward too high');
  });

  it('Allow delegated rewardDistributionAddress to increase rewards', async () => {
    const { pool, rewardToken, other } = await setupNotifyRewardTests();
    // Start the reward distribution
    await pool.setRewardsDistribution(other.address);
    const rewardValue = 10000; //this was the number
    await rewardToken.transfer(pool.address, rewardValue);
    await pool.connect(other).notifyRewardAmount(rewardValue);

    // Add more tokens, and check distribution rate
    const initialRewardPerSecond = await pool.rewardRate();
    const initialDuration = await pool.rewardsDuration();
    await rewardToken.transfer(other.address, 100000); // give 'other' some more tokens
    await rewardToken.connect(other).transfer(pool.address, 20000); // give 'other' some more tokens
    await pool.connect(other).notifyRewardAmount(rewardValue);
    const updatedRewardPerSecond = await pool.rewardRate();
    const updatedDuration = await pool.rewardsDuration();

    assert(updatedRewardPerSecond > initialRewardPerSecond); // rewardRate is higher now
    assert(initialDuration.toNumber() === updatedDuration.toNumber()); // no changes to duration
  });

  it('should increase rewards duration before starting distribution', async () => {
    const { pool } = await setupNotifyRewardTests();
    const defaultDuration = await pool.rewardsDuration();
    assert(defaultDuration.toNumber() === 50);

    await pool.setRewardsDuration(1000);
    const newDuration = await pool.rewardsDuration();
    assert(newDuration.toNumber() === 1000);
  });

  it('should revert when setting setRewardsDuration before the period has finished', async () => {
    const { pool, stakedToken, rewardToken, stakingAccount1 } = await setupNotifyRewardTests();

    const totalToStake = 100;
    const totalToDistribute = 5000;

    await stakedToken.transfer(stakingAccount1.address, totalToStake);
    await stakedToken.connect(stakingAccount1).approve(pool.address, totalToStake);
    await pool.connect(stakingAccount1).stake(totalToStake);

    await rewardToken.transfer(pool.address, totalToDistribute);
    await pool.notifyRewardAmount(totalToDistribute);

    await evmIncreaseSeconds(10);
    const tx = pool.setRewardsDuration(30);

    await expect(tx).to.be.revertedWith(
      'Previous rewards period must be complete before changing the duration for the new period',
    );
  });

  it('should update when setting setRewardsDuration after the period has finished', async () => {
    const { pool, stakedToken, rewardToken, stakingAccount1 } = await setupNotifyRewardTests();

    const totalToStake = 100;
    const totalToDistribute = 5000;

    await stakedToken.transfer(stakingAccount1.address, totalToStake);
    await stakedToken.connect(stakingAccount1).approve(pool.address, totalToStake);
    await pool.connect(stakingAccount1).stake(totalToStake);

    await rewardToken.transfer(pool.address, totalToDistribute);
    await pool.notifyRewardAmount(totalToDistribute);

    await evmIncreaseSeconds(100); // past 50, which is the original duration.

    const transaction = await pool.setRewardsDuration(100);
    await expect(transaction).to.emit(pool, 'RewardsDurationUpdated').withArgs(100);

    const newDuration = await pool.rewardsDuration();
    assert(newDuration.toNumber() === 100);

    await pool.notifyRewardAmount(totalToDistribute);
  });

  it('should update when setting setRewardsDuration after the period has finished with reward claiming', async () => {
    const { pool, stakedToken, rewardToken, stakingAccount1 } = await setupNotifyRewardTests();

    const totalToStake = 100;
    const totalToDistribute = 5000;

    await stakedToken.transfer(stakingAccount1.address, totalToStake);
    await stakedToken.connect(stakingAccount1).approve(pool.address, totalToStake);
    await pool.connect(stakingAccount1).stake(totalToStake);

    await rewardToken.transfer(pool.address, totalToDistribute);
    await pool.notifyRewardAmount(totalToDistribute);

    await evmIncreaseSeconds(25);
    await pool.connect(stakingAccount1).getReward();
    await evmIncreaseSeconds(25);

    // New Rewards period much lower
    await rewardToken.transfer(pool.address, totalToDistribute);
    const transaction = await pool.setRewardsDuration(100);
    await expect(transaction).to.emit(pool, 'RewardsDurationUpdated').withArgs(100);

    const newDuration = await pool.rewardsDuration();
    assert(newDuration.toNumber() === 100);

    await pool.notifyRewardAmount(totalToDistribute);

    await evmIncreaseSeconds(100);
    await pool.connect(stakingAccount1).getReward();
  });
});
