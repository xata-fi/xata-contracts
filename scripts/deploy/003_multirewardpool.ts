import { ethers, network } from 'hardhat';
import { printDeploymentLogs, getAccounts } from '../../lib/utils';
import { MultiRewardPool__factory, MultiRewardPool } from '../../typechain';

/***
 * Used for deployment of multirewardpools, while setting a predefined reward token and token funder.
 * Be careful when using this.  Sequential contract calls were failing during actual deployment. Highly recommend to try including # of confirmations in contract calls.
 */

// ----- Parameters for creating a reward pool ------ //
// token address for the token to be staked - ie. an LP token address
type DeploymentParameters = { stakingTokenAddress: string; rewardFunderAddress: string; rewardTokenAddress: string };
export const deploymentParamMap: Map<string, DeploymentParameters> = new Map<string, DeploymentParameters>();
deploymentParamMap.set('matic_tenderly', {
  stakingTokenAddress: '0xb0465ec31b55eda4b5c738be24eac74eb9de43eb', // WMATIC/WETH
  rewardFunderAddress: '0xA6AE8dc5f90ea58bd07700C1e63A411c0218767F', // testTokenProvider for testing
  rewardTokenAddress: '0x0b3f868e0be5597d5db7feb59e1cadbb0fdda50a', // SUSHI
});
deploymentParamMap.set('matic', {
  stakingTokenAddress: '0x28ccc6a15a2e6fa8c09cdde9795417e8a9cd6edc', // ATA/USDT
  rewardFunderAddress: '', // TBC
  rewardTokenAddress: '0x0df0f72ee0e5c9b7ca761ecec42754992b2da5bf', // ATA
});
deploymentParamMap.set('bsc', {
  stakingTokenAddress: '0x69E7DCa6d62d9152dd4E0fb3F520cD26F4BF7774', // ATA/USDT
  rewardFunderAddress: '', // TBC
  rewardTokenAddress: '0xa2120b9e674d3fc3875f415a7df52e382f141225', // ATA
});

const DURATION_IN_SECONDS = 2624399; // ~30 days

export async function deployMultiRewardPool(
  deploymentParameters: DeploymentParameters,
  verbose = false,
): Promise<MultiRewardPool> {
  console.log('Deploying Reward multipool');
  const name = 'MultiRewardPool';
  const { deployer, owner } = await getAccounts();
  const multiRewardPoolContract = (await ethers.getContractFactory(name)) as MultiRewardPool__factory;
  const instance = (await multiRewardPoolContract
    .connect(deployer)
    .deploy(deploymentParameters.stakingTokenAddress)) as MultiRewardPool;
  await instance.deployed();
  await instance.transferOwnership(owner.address);
  const deploymentTx = instance.deployTransaction;
  if (verbose) {
    printDeploymentLogs(name, instance.address, deploymentTx.hash);
  }

  console.log('Adding rewardToken parameters.');
  const addRewardTxn = await instance
    .connect(owner)
    .addReward(deploymentParameters.rewardTokenAddress, deploymentParameters.rewardFunderAddress, DURATION_IN_SECONDS);
  const receipt = await addRewardTxn.wait();
  const success = receipt.status === 1;
  console.log('Added rewardToken parameters successfully:' + success);
  return instance;
}

// ----- Run the script ------ //
const networkParameters = deploymentParamMap.get(network.name);
if (networkParameters) {
  deployMultiRewardPool(networkParameters, true)
    .then(() => process.exit(0))
    .catch((e) => {
      console.log(e);
      process.exit(1);
    });
} else {
  console.log('Unable to find parameters for network: ' + network.name);
  process.exit(1);
}
