import { ethers } from 'hardhat';

import { use, expect, assert } from 'chai';
import { solidity } from 'ethereum-waffle';
import { resetNetwork } from '../../lib/utils';
import {
  RewardPool,
  RewardPool__factory,
  RewardPoolReceiver,
  RewardPoolReceiver__factory,
  RewardPoolReceiverFactory,
  TestToken,
} from '../../typechain';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

use(solidity);

const TIMEOUT = 10 * 60 * 1000;

describe('RewardPoolReceiverFactory', async () => {
  const setup = async () => {
    await resetNetwork();
    const [signer, dev, funder, staker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory('TestToken');
    const stakedToken = await Token.connect(staker).deploy('10000', 'Staked Token', 'STAKED');
    const rewardToken = await Token.connect(funder).deploy('10000', 'Reward Token', 'REWARD');
    const otherToken = await Token.connect(funder).deploy('10000', 'Other Token', 'OTHER');

    const ReceiverFactory = await ethers.getContractFactory('RewardPoolReceiverFactory');
    const receiverFactory = await ReceiverFactory.deploy();
    receiverFactory.setDefaultDev(dev.address); // grant manager access to dev.address

    return { signer, dev, funder, staker, receiverFactory, stakedToken, rewardToken, otherToken };
  };

  // factory initialized properly
  it('initializes correctly', async () => {
    const { receiverFactory, dev, staker, funder, stakedToken, rewardToken, otherToken } = await setup();
    assert((await stakedToken.balanceOf(staker.address)).toNumber() === 10000);
    assert((await rewardToken.balanceOf(funder.address)).toNumber() === 10000);
    assert((await otherToken.balanceOf(funder.address)).toNumber() === 10000);
    assert((await receiverFactory.defaultDev()) === dev.address);
  }).timeout(TIMEOUT);

  const createReceiver = async (
    signer: SignerWithAddress,
    receiverFactory: RewardPoolReceiverFactory,
    rewardToken: TestToken,
  ): Promise<RewardPoolReceiver> => {
    await receiverFactory.createReceiver(rewardToken.address);
    const receiverCreatedFilter = receiverFactory.filters.ReceiverCreated();
    const receiverCreatedEvent = await receiverFactory.queryFilter(receiverCreatedFilter, 'latest');
    const receiverAddress = receiverCreatedEvent[0].args[0];
    return RewardPoolReceiver__factory.connect(receiverAddress, signer);
  };

  const createRewardPool = async (
    signer: SignerWithAddress,
    dev: SignerWithAddress,
    receiver: RewardPoolReceiver,
    stakedToken: TestToken,
  ): Promise<RewardPool> => {
    await receiver.connect(dev).createRewardPool(stakedToken.address, 1); // dev should be able to create rewardpool
    const rewardPoolCreatedFilter = receiver.filters.RewardPoolCreated();
    const rewardPoolCreatedEvent = await receiver.queryFilter(rewardPoolCreatedFilter, 'latest');
    const rewardPoolAddress = rewardPoolCreatedEvent[0].args[0];
    return RewardPool__factory.connect(rewardPoolAddress, signer);
  };

  it('create and fund a receiver and reward pool', async () => {
    // Create receiver
    const { signer, dev, funder, receiverFactory, stakedToken, rewardToken } = await setup();
    const receiver = await createReceiver(signer, receiverFactory, rewardToken);

    // Fund Receiver and create reward pool
    await rewardToken.connect(funder).transfer(receiver.address, 10000);
    const rewardPool = await createRewardPool(signer, dev, receiver, stakedToken);
    await receiver.sendRewardsToRewardPool(); // only owner should be able to send the rewards over
    assert((await rewardToken.balanceOf(rewardPool.address)).toNumber() === 10000);
  }).timeout(TIMEOUT);

  it('create and fund a receiver, withdraw part of rewards to owner, fund reward pool', async () => {
    // Create receiver
    const { signer, dev, funder, receiverFactory, stakedToken, rewardToken } = await setup();
    const receiver = await createReceiver(signer, receiverFactory, rewardToken);

    // Fund Receiver and create reward pool
    await rewardToken.connect(funder).transfer(receiver.address, 10000);
    await receiver.connect(dev)['recover(address,uint256)'](rewardToken.address, 5000); // recover 5000 of the tokens

    const rewardPool = await createRewardPool(signer, dev, receiver, stakedToken);
    await receiver.sendRewardsToRewardPool(); // only owner should be able to send the rewards over
    assert((await rewardToken.balanceOf(rewardPool.address)).toNumber() === 5000);
    assert((await rewardToken.balanceOf(signer.address)).toNumber() === 5000);
  }).timeout(TIMEOUT);

  it('fund a receiver with the wrong token, and reward tokens. recover the wrongly sent token', async () => {
    // Create receiver
    const { signer, dev, funder, receiverFactory, stakedToken, rewardToken, otherToken } = await setup();
    const receiver = await createReceiver(signer, receiverFactory, rewardToken);

    // Fund Receiver and create rewardPool
    await rewardToken.connect(funder).transfer(receiver.address, 10000);
    await otherToken.connect(funder).transfer(receiver.address, 5000);
    await receiver.connect(dev)['recover(address)'](otherToken.address); // recover all of the wrong tokens

    const rewardPool = await createRewardPool(signer, dev, receiver, stakedToken);
    await receiver.sendRewardsToRewardPool(); // only owner should be able to send the rewards over
    assert((await rewardToken.balanceOf(rewardPool.address)).toNumber() === 10000);
    assert((await otherToken.balanceOf(receiver.address)).toNumber() === 0);
    assert((await otherToken.balanceOf(signer.address)).toNumber() === 5000); // successfully recovered tokens
  }).timeout(TIMEOUT);

  it('fund rewardPool with fees for lead address', async () => {
    // Create receiver
    const { signer, dev, funder, receiverFactory, stakedToken, rewardToken } = await setup();
    await receiverFactory.setFee(50); // 5%
    const receiver = await createReceiver(signer, receiverFactory, rewardToken);

    // Fund Receiver and create rewardPool
    await rewardToken.connect(funder).transfer(receiver.address, 10000);

    const rewardPool = await createRewardPool(signer, dev, receiver, stakedToken);
    await receiver.sendRewardsToRewardPool(); // only owner should be able to send the rewards over
    assert((await rewardToken.balanceOf(rewardPool.address)).toNumber() === 9500);
    assert((await rewardToken.balanceOf(signer.address)).toNumber() === 500); // collected fees
  }).timeout(TIMEOUT);

  it('create and fund a receiver, create rewardPool, recover reward or other tokens', async () => {
    // Create receiver
    const { signer, dev, funder, receiverFactory, stakedToken, rewardToken, otherToken } = await setup();
    await receiverFactory.setFee(50); // 5%
    const receiver = await createReceiver(signer, receiverFactory, rewardToken);

    // Fund Receiver and create rewardPool
    await rewardToken.connect(funder).transfer(receiver.address, 10000);

    const rewardPool = await createRewardPool(signer, dev, receiver, stakedToken);
    await receiver.sendRewardsToRewardPool(); // only owner should be able to send the rewards over
    assert((await rewardToken.balanceOf(signer.address)).toNumber() === 500);
    assert((await rewardToken.balanceOf(rewardPool.address)).toNumber() === 9500);
    // Also add otherTokens to the rewardPool
    await otherToken.connect(funder).transfer(rewardPool.address, 10000);

    // recover tokens
    await rewardPool.recoverERC20(rewardToken.address, 9500);
    assert((await rewardToken.balanceOf(signer.address)).toNumber() === 10000); // recovered tokens
    assert((await rewardToken.balanceOf(rewardPool.address)).toNumber() === 0); // recovered tokens
    await rewardPool.recoverERC20(otherToken.address, 10000);
    assert((await otherToken.balanceOf(signer.address)).toNumber() === 10000); // recovered tokens
  }).timeout(TIMEOUT);
});
