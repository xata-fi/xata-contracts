import { ethers, network } from 'hardhat';

import { use, expect, assert } from 'chai';
import { solidity } from 'ethereum-waffle';
import { resetNetwork } from '../../lib/utils';

const DURATION = 864000;
const TIMEOUT = 10 * 60 * 1000;

use(solidity);
describe('MultiRewardPool', async () => {
  const setup = async () => {
    await resetNetwork();
    const [signer, funder1, funder2, other] = await ethers.getSigners();

    const Token = await ethers.getContractFactory('TestToken');
    const stakedToken = await Token.deploy('10000', 'Staked Token', 'STAKED');
    const rewardToken1 = await Token.deploy('10000', 'Reward Token 1', 'REWARD1');
    const rewardToken2 = await Token.deploy('10000', 'Reward Token 2', 'REWARD2');
    const otherToken = await Token.deploy('10000', 'Other Token', 'OTHER');

    // Funders should hold respective reward tokens
    await rewardToken1.transfer(funder1.address, 10000);
    await rewardToken2.transfer(funder2.address, 10000);

    const Pool = await ethers.getContractFactory('MultiRewardPool');
    const pool = await Pool.deploy(stakedToken.address);

    // Funders should let pool spend their reward tokens when funding+notifying
    await rewardToken1.connect(funder1).approve(pool.address, 10000);
    await rewardToken2.connect(funder2).approve(pool.address, 10000);

    // Funders should be set as respective reward distributors
    await pool.addReward(rewardToken1.address, funder1.address, DURATION);
    await pool.addReward(rewardToken2.address, funder2.address, DURATION);

    return { signer, funder1, funder2, other, pool, stakedToken, rewardToken1, rewardToken2, otherToken };
  };

  it('initializes correctly', async () => {
    const { pool, funder1, funder2, stakedToken, rewardToken1, rewardToken2 } = await setup();
    expect(await pool.stakingToken()).to.equal(stakedToken.address);
    expect(await rewardToken1.balanceOf(funder1.address)).equal(10000);
    expect(await rewardToken2.balanceOf(funder2.address)).equal(10000);
    const rewardData1 = await pool.rewardData(rewardToken1.address);
    expect(rewardData1.rewardsDistributor).equal(funder1.address);
    const rewardData2 = await pool.rewardData(rewardToken2.address);
    expect(rewardData2.rewardsDistributor).equal(funder2.address);

    // only rewardDistributors of a particular rewardToken may modify its parameters
    await expect(pool.setRewardsDuration(rewardToken1.address, 1)).to.be.revertedWith(
      'Caller not reward distributor for this token.',
    );
    await expect(pool.setRewardsDuration(rewardToken2.address, 1)).to.be.revertedWith(
      'Caller not reward distributor for this token.',
    );
    await expect(pool.notifyRewardAmount(rewardToken1.address, 1)).to.be.revertedWith(
      'Caller not reward distributor for this token.',
    );
    await expect(pool.notifyRewardAmount(rewardToken2.address, 1)).to.be.revertedWith(
      'Caller not reward distributor for this token.',
    );

    await expect(pool.connect(funder2).setRewardsDuration(rewardToken1.address, 1)).to.be.revertedWith(
      'Caller not reward distributor for this token.',
    );
    await expect(pool.connect(funder2).notifyRewardAmount(rewardToken1.address, 1)).to.be.revertedWith(
      'Caller not reward distributor for this token.',
    );
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

  it("should let owner withdraw 'reward' tokens", async () => {
    const { signer, funder1, pool, rewardToken1 } = await setup();

    const bal = await rewardToken1.balanceOf(funder1.address);

    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, bal);
    const balOfPool = await rewardToken1.balanceOf(pool.address);
    await pool.recoverERC20(rewardToken1.address, bal);
    const balOfPoolAfter = await rewardToken1.balanceOf(pool.address);

    const balRecovered = await rewardToken1.balanceOf(signer.address);

    expect(bal).to.equal(balRecovered);
    expect(balOfPoolAfter).to.equal(0);
    expect(balOfPool).not.to.equal(balOfPoolAfter);
  }).timeout(TIMEOUT);

  it("should not let owner withdraw 'stake' tokens", async () => {
    const { signer, funder1, pool, stakedToken, rewardToken1 } = await setup();

    // Fund rewards
    const bal = await rewardToken1.balanceOf(funder1.address);
    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, bal);
    // Add staking token
    await stakedToken.approve(pool.address, 5000);
    await pool.stake(5000);
    // Owner to try withdrawing
    const tx = pool.recoverERC20(stakedToken.address, 10);

    await expect(tx).to.be.revertedWith('Cannot withdraw the staking token');
  }).timeout(TIMEOUT);

  const setupEconomicTests = async () => {
    await resetNetwork();
    const [signer, funder1, funder2, staker1, staker2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory('TestToken');
    const stakedToken = await Token.deploy('10000', 'Staked Token', 'STAKED');
    const rewardToken1 = await Token.deploy('10000', 'Reward Token 1', 'REWARD1');
    const rewardToken2 = await Token.deploy('10000', 'Reward Token 2', 'REWARD2');

    const Pool = await ethers.getContractFactory('MultiRewardPool');
    const pool = await Pool.deploy(stakedToken.address);

    // Distribute 1000 staked tokens to various stakers, and have them approve the pool.
    await stakedToken.transfer(staker1.address, 1000);
    await stakedToken.connect(staker1).approve(pool.address, 1000);
    await stakedToken.transfer(staker2.address, 1000);
    await stakedToken.connect(staker2).approve(pool.address, 1000);

    // Funders should hold respective reward tokens
    await rewardToken1.transfer(funder1.address, 10000);
    await rewardToken2.transfer(funder2.address, 10000);

    // Funders should let pool spend their reward tokens when funding+notifying
    await rewardToken1.connect(funder1).approve(pool.address, 10000);
    await rewardToken2.connect(funder2).approve(pool.address, 10000);

    // Funders should be set as respective reward distributors
    await pool.addReward(rewardToken1.address, funder1.address, 10000); //Duration of 10,000s
    await pool.addReward(rewardToken2.address, funder2.address, 10000);

    return { signer, funder1, funder2, pool, stakedToken, rewardToken1, rewardToken2, staker1, staker2 };
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
    const { funder1, funder2, pool, rewardToken1, rewardToken2, staker1, staker2 } = await setupEconomicTests();

    // users to stake their LP into a pool that hasn't started
    await pool.connect(staker1).stake(100);
    await pool.connect(staker2).stake(200);

    // Fund rewards
    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, 10000);
    await pool.connect(funder2).notifyRewardAmount(rewardToken2.address, 10000);

    await runToRewardCompletionTime();

    // Get rewards
    let tx = await pool.connect(staker1).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');
    tx = await pool.connect(staker2).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');

    // Verify RewardToken1 balances
    const staker1Reward1 = (await rewardToken1.balanceOf(staker1.address)).toNumber();
    const staker2Reward1 = (await rewardToken1.balanceOf(staker2.address)).toNumber();
    const reward1RemainingInPool = await rewardToken1.balanceOf(pool.address);

    assert(staker1Reward1 > 0);
    assert(staker2Reward1 === staker1Reward1 * 2); // since staker 2 staked twice as many tokens.
    assert(staker1Reward1 > reward1RemainingInPool.toNumber()); // there should be more tokens given out than left in the pool.

    // Verify RewardToken2 balances
    const staker1Reward2 = (await rewardToken2.balanceOf(staker1.address)).toNumber();
    const staker2Reward2 = (await rewardToken2.balanceOf(staker2.address)).toNumber();
    const reward2RemainingInPool = await rewardToken2.balanceOf(pool.address);
    assert(staker1Reward2 > 0);
    assert(staker2Reward2 === staker1Reward2 * 2); // since staker 2 staked twice as many tokens.
    assert(staker1Reward2 > reward2RemainingInPool.toNumber()); // there should be more tokens given out than left in the pool.
  }).timeout(TIMEOUT);

  it('issue correct rewards for stakers who started staking before and after rewards started', async () => {
    const { funder1, funder2, pool, rewardToken1, rewardToken2, staker1, staker2 } = await setupEconomicTests();

    // users to stake their LP into a pool that hasn't started
    await pool.connect(staker1).stake(100);

    // Fund rewards
    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, 10000);
    await pool.connect(funder2).notifyRewardAmount(rewardToken2.address, 10000);

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

    const staker1Reward1 = (await rewardToken1.balanceOf(staker1.address)).toNumber();
    const staker2Reward1 = (await rewardToken1.balanceOf(staker2.address)).toNumber();
    assert(staker1Reward1 > 0);
    assert(staker1Reward1 > staker2Reward1); // staker 1 should have more tokens
    assert(staker1Reward1 < staker2Reward1 * 2); // but not as much as twice

    const staker1Reward2 = (await rewardToken2.balanceOf(staker1.address)).toNumber();
    const staker2Reward2 = (await rewardToken2.balanceOf(staker2.address)).toNumber();
    assert(staker1Reward2 > 0);
    assert(staker1Reward2 > staker2Reward2); // staker 1 should have more tokens
    assert(staker1Reward2 < staker2Reward2 * 2); // but not as much as twice
  }).timeout(TIMEOUT);

  it('claiming rewards midway through time period should not affect final reward amounts.. much', async () => {
    const { funder1, funder2, pool, rewardToken1, rewardToken2, staker1, staker2 } = await setupEconomicTests();

    await pool.connect(staker1).stake(100);
    await pool.connect(staker2).stake(100);

    // Fund rewards
    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, 10000);
    await pool.connect(funder2).notifyRewardAmount(rewardToken2.address, 10000);

    // let some time pass
    await evmIncreaseSeconds(1000);

    await pool.connect(staker1).getReward();

    await runToRewardCompletionTime();

    // Get rewards
    let tx = await pool.connect(staker1).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');
    tx = await pool.connect(staker2).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');

    const staker1Reward1 = (await rewardToken1.balanceOf(staker1.address)).toNumber();
    const staker2Reward1 = (await rewardToken1.balanceOf(staker2.address)).toNumber();
    assert(staker1Reward1 > 0);
    const rewardDifference = Math.abs(staker2Reward1 - staker1Reward1);
    assert(rewardDifference / staker1Reward1 < 0.01); // total rewards for both should be within 1% margin of error

    const staker1Reward2 = (await rewardToken2.balanceOf(staker1.address)).toNumber();
    const staker2Reward2 = (await rewardToken2.balanceOf(staker2.address)).toNumber();
    assert(staker1Reward2 > 0);
    const rewardDifference2 = Math.abs(staker2Reward2 - staker1Reward2);
    assert(rewardDifference2 / staker1Reward2 < 0.01); // total rewards for both should be within 1% margin of error
  }).timeout(TIMEOUT);

  it('users who withdraw early will have lesser rewards, for only 1 reward token', async () => {
    const { funder1, pool, rewardToken1, staker1, staker2 } = await setupEconomicTests();

    await pool.connect(staker1).stake(100);
    await pool.connect(staker2).stake(100);

    // Fund rewards
    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, 10000);

    // let some time pass
    await evmIncreaseSeconds(1000);

    await pool.connect(staker1).withdraw(100);

    await runToRewardCompletionTime();

    // Get rewards
    let tx = await pool.connect(staker1).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');
    tx = await pool.connect(staker2).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');

    const staker1Rewards = (await rewardToken1.balanceOf(staker1.address)).toNumber();
    const staker2Rewards = (await rewardToken1.balanceOf(staker2.address)).toNumber();
    assert(staker1Rewards > 0);
    assert(staker1Rewards < staker2Rewards); // staker1 has lesser rewards because they withdrew before reward completion
  }).timeout(TIMEOUT);

  it('users who add to their stake midway will have more rewards', async () => {
    const { funder1, funder2, pool, rewardToken1, rewardToken2, staker1, staker2 } = await setupEconomicTests();

    await pool.connect(staker1).stake(100);
    await pool.connect(staker2).stake(100);

    // Fund rewards
    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, 10000);
    await pool.connect(funder2).notifyRewardAmount(rewardToken2.address, 10000);

    // let some time pass
    await evmIncreaseSeconds(2000);

    await pool.connect(staker1).stake(300);

    await runToRewardCompletionTime();

    // Get rewards
    let tx = await pool.connect(staker1).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');
    tx = await pool.connect(staker2).getReward();
    await expect(tx).to.emit(pool, 'RewardPaid');

    const staker1Reward1 = (await rewardToken1.balanceOf(staker1.address)).toNumber();
    const staker2Reward1 = (await rewardToken1.balanceOf(staker2.address)).toNumber();
    assert(staker2Reward1 > 0);
    assert(staker1Reward1 > staker2Reward1); // staker1 has more staked over time.

    const staker1Reward2 = (await rewardToken2.balanceOf(staker1.address)).toNumber();
    const staker2Reward2 = (await rewardToken2.balanceOf(staker2.address)).toNumber();
    assert(staker2Reward2 > 0);
    assert(staker1Reward2 > staker2Reward2); // staker1 has more staked over time.
  }).timeout(TIMEOUT);

  const setupNotifyRewardTests = async () => {
    await resetNetwork();
    const [signer, funder1, funder2, other, stakingAccount1, stakingAccount2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory('TestToken');
    const stakedToken = await Token.deploy('1000000', 'Staked Token', 'STAKED');
    const rewardToken1 = await Token.deploy('1000000', 'Reward Token 1', 'REWARD1');
    const rewardToken2 = await Token.deploy('1000000', 'Reward Token 2', 'REWARD2');

    const Pool = await ethers.getContractFactory('MultiRewardPool');
    const pool = await Pool.deploy(stakedToken.address);

    // Distribute 1000 staked tokens to various stakers, and have them approve the pool.
    await stakedToken.transfer(stakingAccount1.address, 1000);
    await stakedToken.connect(stakingAccount1).approve(pool.address, 1000);
    await stakedToken.transfer(stakingAccount2.address, 1000);
    await stakedToken.connect(stakingAccount2).approve(pool.address, 1000);

    // Funders should hold respective reward tokens
    await rewardToken1.transfer(funder1.address, 1000000);
    await rewardToken2.transfer(funder2.address, 1000000);

    // Funders should let pool spend their reward tokens when funding+notifying
    await rewardToken1.connect(funder1).approve(pool.address, 1000000);
    await rewardToken2.connect(funder2).approve(pool.address, 1000000);

    // Funders should be set as respective reward distributors
    await pool.addReward(rewardToken1.address, funder1.address, 50);
    await pool.addReward(rewardToken2.address, funder2.address, 50);

    return {
      signer,
      funder1,
      funder2,
      other,
      stakingAccount1,
      stakingAccount2,
      pool,
      stakedToken,
      rewardToken1,
      rewardToken2,
    };
  };

  it('Reverts if the provided reward is greater than the funders balance.', async () => {
    const { funder1, pool, rewardToken1 } = await setupNotifyRewardTests();
    const funder1Balance = await rewardToken1.balanceOf(funder1.address);
    const tx = pool.connect(funder1).notifyRewardAmount(rewardToken1.address, funder1Balance.toNumber() + 1000);
    await expect(tx).to.be.revertedWith('ERC20: transfer amount exceeds balance');
  });

  it('Allow delegated rewardDistributionAddress to increase rewards', async () => {
    const { funder1, pool, rewardToken1 } = await setupNotifyRewardTests();
    // Start the reward distribution
    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, 50000);
    const initialRewardData = await pool.rewardData(rewardToken1.address);

    // Add more tokens, and check distribution rate
    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, 50000);
    const updatedRewardData = await pool.rewardData(rewardToken1.address);

    assert(updatedRewardData.rewardRate.toNumber() > initialRewardData.rewardRate.toNumber()); // rewardRate is higher now
    assert(initialRewardData.rewardsDuration.toNumber() === initialRewardData.rewardsDuration.toNumber()); // no changes to duration
  });

  it('should increase rewards duration before starting distribution', async () => {
    const { funder1, pool, rewardToken1 } = await setupNotifyRewardTests();
    const defaultDuration = (await pool.rewardData(rewardToken1.address)).rewardsDuration;
    assert(defaultDuration.toNumber() === 50);

    await pool.connect(funder1).setRewardsDuration(rewardToken1.address, 1000);
    const newDuration = (await pool.rewardData(rewardToken1.address)).rewardsDuration;
    assert(newDuration.toNumber() === 1000);
  });

  it('should revert when setting setRewardsDuration before the period has finished', async () => {
    const { funder1, pool, stakedToken, rewardToken1, stakingAccount1 } = await setupNotifyRewardTests();

    const totalToStake = 100;
    const totalToDistribute = 5000;

    await stakedToken.transfer(stakingAccount1.address, totalToStake);
    await stakedToken.connect(stakingAccount1).approve(pool.address, totalToStake);
    await pool.connect(stakingAccount1).stake(totalToStake);

    await pool.connect(funder1).notifyRewardAmount(rewardToken1.address, totalToDistribute);

    await evmIncreaseSeconds(10);
    const tx = pool.connect(funder1).setRewardsDuration(rewardToken1.address, 30);

    await expect(tx).to.be.revertedWith('Reward period still active');
  });

  it('should update when setting setRewardsDuration after the period has finished', async () => {
    const { funder2, pool, stakedToken, rewardToken2, stakingAccount1 } = await setupNotifyRewardTests();

    const totalToStake = 100;
    const totalToDistribute = 5000;

    await stakedToken.transfer(stakingAccount1.address, totalToStake);
    await stakedToken.connect(stakingAccount1).approve(pool.address, totalToStake);
    await pool.connect(stakingAccount1).stake(totalToStake);

    await pool.connect(funder2).notifyRewardAmount(rewardToken2.address, totalToDistribute);

    await evmIncreaseSeconds(100); // past 50, which is the original duration.

    const transaction = await pool.connect(funder2).setRewardsDuration(rewardToken2.address, 100);
    await expect(transaction).to.emit(pool, 'RewardsDurationUpdated').withArgs(rewardToken2.address, 100);

    const newDuration = (await pool.rewardData(rewardToken2.address)).rewardsDuration;
    assert(newDuration.toNumber() === 100);

    await pool.connect(funder2).notifyRewardAmount(rewardToken2.address, totalToDistribute);
  });

  it('should update when setting setRewardsDuration after the period has finished with reward claiming', async () => {
    const { funder2, pool, stakedToken, rewardToken2, stakingAccount1 } = await setupNotifyRewardTests();

    const totalToStake = 100;
    const totalToDistribute = 5000;

    await stakedToken.transfer(stakingAccount1.address, totalToStake);
    await stakedToken.connect(stakingAccount1).approve(pool.address, totalToStake);
    await pool.connect(stakingAccount1).stake(totalToStake);

    await pool.connect(funder2).notifyRewardAmount(rewardToken2.address, totalToDistribute);

    await evmIncreaseSeconds(25);
    await pool.connect(stakingAccount1).getReward();
    await evmIncreaseSeconds(25);

    // New Rewards period much lower
    const transaction = await pool.connect(funder2).setRewardsDuration(rewardToken2.address, 100);
    await expect(transaction).to.emit(pool, 'RewardsDurationUpdated').withArgs(rewardToken2.address, 100);

    const newDuration = (await pool.rewardData(rewardToken2.address)).rewardsDuration;
    assert(newDuration.toNumber() === 100);

    await pool.connect(funder2).notifyRewardAmount(rewardToken2.address, totalToDistribute);

    await evmIncreaseSeconds(100);

    await pool.connect(stakingAccount1).getReward();
  });
});
