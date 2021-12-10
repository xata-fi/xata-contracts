import { network, ethers, artifacts } from 'hardhat';
import { IERC20 } from '../../typechain';
import { deployMultiRewardPool } from '../deploy/003_multirewardpool';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';

/**
 * This script is intended for demo testing, kept in here for record purposes.
 * Will need refactoring for this to work with the new deploy function.
 */

// ----- Parameters for testing reward pool ------ //
type RewardTokenParams = { rewardTokenAddress: string; amount: string; durationInDays: number };
type RewardPoolParams = { stakingTokenAddress: string; rewards: RewardTokenParams[] };

const airdropAddressses = [
  '', // remember to put addresses here!
];

const tokenAddressToDistribute = [
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
  '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', // DAI
  '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
  '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a', // SUSHI
  '0x0df0f72ee0e5c9b7ca761ecec42754992b2da5bf', // ATA
];

async function sendMatic(from: SignerWithAddress, to: string, amount: BigNumber) {
  await from.sendTransaction({
    to: to,
    value: amount,
  });
}

async function fundAccounts(testTokenProvider: SignerWithAddress) {
  console.log('Fund accounts');
  const ierc20Artifact = await artifacts.readArtifact('IERC20');
  // Fund accounts with base txn currency
  for (const airdropAddress of airdropAddressses) {
    await sendMatic(testTokenProvider, airdropAddress, BigNumber.from('10000000000000000000')); //10
    console.log('Sent 10 MATIC to ' + airdropAddress);
  }

  for (const tokenAddress of tokenAddressToDistribute) {
    const tokenContract = (await ethers.getContractAt(ierc20Artifact.abi, tokenAddress)) as IERC20;
    for (const airdropAddress of airdropAddressses) {
      await tokenContract
        .connect(testTokenProvider)
        .transfer(airdropAddress, BigNumber.from('10000000000000000000000')); //10000
      console.log('Sent staking token to to ' + airdropAddress);
      const balance = await tokenContract.balanceOf(airdropAddress);
      console.log(airdropAddress + 'now has ' + balance + ' of ' + tokenAddress);
    }
  }
  console.log('Finished funding accounts');
}

async function runIntegrationTest(rewardPoolParams: RewardPoolParams[]) {
  // ---------- Setup Parameters ------------ //
  const SECONDS_IN_A_DAY = 86400; // in seconds
  const UNLIMITED = BigNumber.from('999999999999999999999999999999999999');
  const [owner, deployer, testTokenProvider] = await ethers.getSigners();
  const ierc20Artifact = await artifacts.readArtifact('IERC20');

  // ---------- Setup Test State ------------ //
  await fundAccounts(testTokenProvider);

  for (const eachPool of rewardPoolParams) {
    const multiRewardPool = await deployMultiRewardPool(eachPool.stakingTokenAddress, true);
    console.log('Created rewardPool at ' + multiRewardPool.address);
    for (const eachReward of eachPool.rewards) {
      await multiRewardPool
        .connect(owner)
        .addReward(
          eachReward.rewardTokenAddress,
          testTokenProvider.address,
          eachReward.durationInDays * SECONDS_IN_A_DAY,
        );
      console.log('Added reward token ' + eachReward.rewardTokenAddress + ' to rewardPool ' + multiRewardPool.address);
      await multiRewardPool
        .connect(testTokenProvider)
        .notifyRewardAmount(eachReward.rewardTokenAddress, BigNumber.from(eachReward.amount));
      console.log(
        'Notified and started rewards for ' +
          eachReward.rewardTokenAddress +
          ' to rewardPool ' +
          multiRewardPool.address,
      );
    }
  }
}

const scenarioParameters: Map<string, RewardPoolParams[]> = new Map<string, RewardPoolParams[]>();
scenarioParameters.set('matic_tenderly', [
  {
    stakingTokenAddress: '0x15ef04c00733030aff1a6dc0c74e855589d0bb4a', // WMATIC/DAI
    rewards: [
      {
        rewardTokenAddress: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', //WMATIC
        amount: '10000000000000000000000', // 10,000
        durationInDays: 7,
      },
    ],
  },
  {
    stakingTokenAddress: '0x2c38ed4a5759d8ba951193b574ed228d9d7f031e', // SUSHI/WMATIC
    rewards: [
      {
        rewardTokenAddress: '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a', // SUSHI
        amount: '10000000000000000000000', // 10,000
        durationInDays: 3,
      },
      {
        rewardTokenAddress: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', // USDT
        amount: '10000000000000000000000', // 10,000
        durationInDays: 3,
      },
    ],
  },
  {
    stakingTokenAddress: '0x081b2cf5bf516d909b57d0e3e4e50eb4047eebb8', // ATA/MWATIC
    rewards: [
      {
        rewardTokenAddress: '0x0df0f72ee0e5c9b7ca761ecec42754992b2da5bf', // ATA
        amount: '10000000000000000000000', // 10,000
        durationInDays: 10,
      },
      {
        rewardTokenAddress: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
        amount: '10000000000000000000000', // 10,000
        durationInDays: 10,
      },
    ],
  },
]);

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
  runIntegrationTest(networkParameters)
    .then(() => process.exit(0))
    .catch((e) => {
      console.log(e);
      process.exit(1);
    });
} else {
  console.log('Unable to find parameters for network: ' + network.name);
  process.exit(1);
}
