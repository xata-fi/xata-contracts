import { network, ethers, artifacts } from 'hardhat';
import { sendEth, delay } from '../../lib/utils';
import { IERC20, MultiRewardPool } from '../../typechain';
import { deployMultiRewardPool } from '../deploy/003_multirewardpool';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';

/*
  This script is for deploying and testing Multi Reward Pool in tenderly forks.
 */
async function returnAllERC20(account: SignerWithAddress, token: IERC20, tokenProvider: SignerWithAddress) {
  const balance = await token.balanceOf(account.address);
  if (balance.gt(0)) {
    await token.connect(account).transfer(tokenProvider.address, balance);
  }
}

async function fundAccounts(
  testTokenProvider: SignerWithAddress,
  owner: SignerWithAddress,
  funder1: SignerWithAddress,
  funder2: SignerWithAddress,
  staker1: SignerWithAddress,
  staker2: SignerWithAddress,
  stakingToken: IERC20,
  reward1: IERC20,
  reward2: IERC20,
) {
  console.log('Fund accounts');
  // Fund accounts with base txn currency
  await sendEth(testTokenProvider, funder1, BigNumber.from('10000000000000000000')); //10
  await sendEth(testTokenProvider, funder2, BigNumber.from('10000000000000000000'));
  await sendEth(testTokenProvider, staker1, BigNumber.from('10000000000000000000'));
  await sendEth(testTokenProvider, staker2, BigNumber.from('10000000000000000000'));

  console.log('Return rewards and distribute reward tokens to funders');
  await returnAllERC20(staker1, reward1, testTokenProvider);
  await returnAllERC20(staker2, reward1, testTokenProvider);
  await reward1.connect(testTokenProvider).transfer(funder1.address, BigNumber.from('100000000000000000000')); //100
  await returnAllERC20(staker1, reward2, testTokenProvider);
  await returnAllERC20(staker2, reward2, testTokenProvider);
  await returnAllERC20(owner, reward2, testTokenProvider);
  await reward2.connect(testTokenProvider).transfer(funder2.address, BigNumber.from('200000000000000000000')); //200

  // Give stakers LP tokens
  await stakingToken.connect(testTokenProvider).transfer(staker1.address, BigNumber.from('10000000000000000000')); //10
  await stakingToken.connect(testTokenProvider).transfer(staker2.address, BigNumber.from('10000000000000000000'));
  console.log('Finished funding accounts');
}

async function printStatus(
  multiRewardPool: MultiRewardPool,
  reward1: IERC20,
  reward2: IERC20,
  staker: SignerWithAddress,
) {
  console.log('----------------- Printing status for ' + staker.address + ' ----------------------');
  console.log('Staked LP: ' + (await multiRewardPool.balanceOf(staker.address)).toString());
  console.log('Reward1 earned in pool: ' + (await multiRewardPool.earned(staker.address, reward1.address)).toString());
  console.log('Reward2 earned in pool: ' + (await multiRewardPool.earned(staker.address, reward2.address)).toString());
  console.log('Reward1 balance: ' + (await reward1.balanceOf(staker.address)).toString());
  console.log('Reward2 balance: ' + (await reward2.balanceOf(staker.address)).toString());
  console.log(
    '-------------------------------------------------------------------------------------------------------------------------------------------',
  );
}

async function runIntegrationTest(stakingTokenAddress: string, reward1Address: string, reward2Address: string) {
  // ---------- Setup Parameters ------------ //
  const SEVEN_DAYS = 604800; // in seconds
  const UNLIMITED = BigNumber.from('999999999999999999999999999999999999');
  const [owner, deployer, testTokenProvider, funder1, funder2, staker1, staker2] = await ethers.getSigners();
  const ierc20Artifact = await artifacts.readArtifact('IERC20');
  const stakingToken = (await ethers.getContractAt(ierc20Artifact.abi, stakingTokenAddress)) as IERC20;
  const reward1 = (await ethers.getContractAt(ierc20Artifact.abi, reward1Address)) as IERC20;
  const reward2 = (await ethers.getContractAt(ierc20Artifact.abi, reward2Address)) as IERC20;

  // ---------- Setup Test State ------------ //
  await fundAccounts(testTokenProvider, owner, funder1, funder2, staker1, staker2, stakingToken, reward1, reward2);

  const multiRewardPool = await deployMultiRewardPool(stakingTokenAddress, true);

  // - Owner adds the 2 reward tokens, with funders as distributors, and duration of 7 days
  await multiRewardPool.connect(owner).addReward(reward1.address, funder1.address, SEVEN_DAYS);
  await multiRewardPool.connect(owner).addReward(reward2.address, funder2.address, SEVEN_DAYS);
  console.log('Added rewards.');

  // - Staker1 to stake token
  await stakingToken.connect(staker1).approve(multiRewardPool.address, UNLIMITED);
  await multiRewardPool.connect(staker1).stake(BigNumber.from('10000000000000000000')); //10
  console.log('Staker1 staked.');

  // - Funder1 to notifyRewards
  await reward1.connect(funder1).approve(multiRewardPool.address, UNLIMITED);
  await multiRewardPool.connect(funder1).notifyRewardAmount(reward1.address, BigNumber.from('100000000000000000000')); //100
  console.log('Funder1 added reward tokens.');

  // - Funder2 to change duration of reward2 to 14 days
  // - Funder2 to notifyRewards
  await reward2.connect(funder2).approve(multiRewardPool.address, UNLIMITED);
  await multiRewardPool.connect(funder2).setRewardsDuration(reward2.address, SEVEN_DAYS * 2);
  await multiRewardPool.connect(funder2).notifyRewardAmount(reward2.address, BigNumber.from('100000000000000000000')); //100
  console.log('Funder2 updated reward duration, and added reward tokens.');
  // - Funder2 send in some extra reward2
  await reward2.connect(funder2).transfer(multiRewardPool.address, BigNumber.from('50000000000000000000')); //50
  console.log('Funder2 added some extra rewards.');

  // - Owner to recover the extra reward2
  const oldOwnerReward2Balance = await reward2.balanceOf(owner.address);
  await multiRewardPool.connect(owner).recoverERC20(reward2.address, BigNumber.from('50000000000000000000')); //50
  const newOwnerReward2Balance = await reward2.balanceOf(owner.address);
  console.log(
    'Owner recovered ' +
      newOwnerReward2Balance.sub(oldOwnerReward2Balance) +
      ' reward2 tokens. Success: ' +
      newOwnerReward2Balance.gt(oldOwnerReward2Balance),
  );

  // - Staker2 to stake token
  await stakingToken.connect(staker2).approve(multiRewardPool.address, UNLIMITED);
  await multiRewardPool.connect(staker2).stake(BigNumber.from('10000000000000000000')); //10
  console.log('Staker2 staked. Waiting for a minute.');

  await delay(60000);

  // - printStatus (staked LP, earned reward1, earned reward2, reward1 balance, reward2 balance):
  console.log('Printing staker statuses, they should have earned some rewards, but have no balance as of yet.');
  await printStatus(multiRewardPool, reward1, reward2, staker1);
  await printStatus(multiRewardPool, reward1, reward2, staker2);

  // - Staker1 to claim rewards
  await multiRewardPool.connect(staker1).getReward();
  // - Staker1 to withdraw half of LP tokens
  await multiRewardPool.connect(staker1).withdraw(BigNumber.from('5000000000000000000')); //5

  // - printStatus(staker1) - Check whether balance of rewards has increased, and staked LP has decreased
  console.log(
    'Staker1 has collected rewards and withdrew some LP tokens. Printing status, they should have some reward tokens and lesser LP tokens staked.',
  );
  await printStatus(multiRewardPool, reward1, reward2, staker1);

  // - Wait for a few minutes
  console.log('Wait for more time to pass (another minute).');
  await delay(60000);
  // - Staker1 to exit
  console.log('Staker1 to exit.');
  await multiRewardPool.connect(staker1).exit();
  // - printStatus(staker1) -
  console.log('Printing staker1 status after exiting. Check for 0 staked, and increased reward balance.');
  await printStatus(multiRewardPool, reward1, reward2, staker1);

  // - Funder 2 to notify more reward tokens
  console.log('Test topping up of reward tokens.');
  const initialReward2Rate = (await multiRewardPool.rewardData(reward2.address)).rewardRate;
  await multiRewardPool.connect(funder2).notifyRewardAmount(reward2.address, BigNumber.from('50000000000000000000')); // 50
  const updatedReward2Rate = (await multiRewardPool.rewardData(reward2.address)).rewardRate;
  console.log(
    'InitialReward2Rate: ' +
      initialReward2Rate.toString() +
      ', updatedReward2Rate: ' +
      updatedReward2Rate.toString() +
      '. Rate increase successful: ' +
      updatedReward2Rate.gt(initialReward2Rate),
  );
  console.log('Remember to validate print statements and check for txn failures on tenderly!');
}

// ----- Parameters for testing reward pool ------ //
type ScenarioParameter = { stakingTokenAddress: string; reward1Address: string; reward2Address: string };
const scenarioParameters: Map<string, ScenarioParameter> = new Map<string, ScenarioParameter>();
scenarioParameters.set('matic_tenderly', {
  stakingTokenAddress: '0xb0465ec31b55eda4b5c738be24eac74eb9de43eb', // WMATIC/WETH
  reward1Address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
  reward2Address: '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a', // SUSHI
});

/**
 * Usage:
 *  1. Ensure that you've set 'TEST_TOKEN_PROVIDER_PRIVATE_KEY' in your .env file. This account should contain the reward and LP tokens required for testing.
 *  2. Setup network parameters -> in hardhat.config.ts, and have a corresponding entry in `scenarioParameters` map above.
 *  3. Run this file using `yarn hardhat run scripts/integration-tests/001_multirewardpool.it.ts --network <target_network>`
 */
// ----- Run the script ------ //
const networkParameters = scenarioParameters.get(network.name);
if (networkParameters) {
  console.log('Running integration tests for network: ' + network.name);
  runIntegrationTest(
    networkParameters.stakingTokenAddress,
    networkParameters.reward1Address,
    networkParameters.reward2Address,
  )
    .then(() => process.exit(0))
    .catch((e) => {
      console.log(e);
      process.exit(1);
    });
} else {
  console.log('Unable to find parameters for network: ' + network.name);
  process.exit(1);
}
