import { artifacts, ethers, network } from 'hardhat';
import { MultiRewardPool__factory, MultiRewardPool, IERC20 } from '../../typechain';
import { BigNumber } from 'ethers';
import { deploymentParamMap } from './003_multirewardpool';

/***
 * Used for funding of rewardpools, uses rewardToken parameters set in 002_multirewardpool. Please make sure the right rewardPoolAddress are set before running.
 * Be careful when using this. Sequential contract calls were failing during actual deployment. Highly recommend to try including # of confirmations in contract calls.
 */

// ----- Parameters for creating a reward pool ------ //
// token address for the token to be staked - ie. an LP token address
const rewardPoolAddressMap: Map<string, string> = new Map<string, string>();
rewardPoolAddressMap.set('matic_tenderly', '0xA6AE8dc5f90ea58bd07700C1e63A411c0218767F');
rewardPoolAddressMap.set('matic', '');
rewardPoolAddressMap.set('bsc', '');

const TEN = BigNumber.from('10000000000000000000'); // 10E18
const UNLIMITED = BigNumber.from('999999999999999999999999999999999999');

export async function fundRewardPool(rewardTokenAddress: string, rewardPoolAddress: string) {
  console.log('Funding reward pool ' + rewardPoolAddress + ' with reward token ' + rewardTokenAddress);

  const [rewardFunder] = await ethers.getSigners();
  const ierc20Artifact = await artifacts.readArtifact('IERC20');
  const rewardToken = (await ethers.getContractAt(ierc20Artifact.abi, rewardTokenAddress)) as IERC20;

  console.log('Approving ATA token for spend by rewardpool.');
  const approvalTxn = await rewardToken.connect(rewardFunder).approve(rewardPoolAddress, UNLIMITED);
  const approvalReceipt = await approvalTxn.wait();
  const approvalSuccess = approvalReceipt.status === 1;
  console.log('Approved token successfully:' + approvalSuccess);

  if (approvalSuccess) {
    console.log('Funding reward pool with 10 ATA tokens.');
    const rewardPoolArtifact = await artifacts.readArtifact('MultiRewardPool');
    const rewardPool = (await ethers.getContractAt(rewardPoolArtifact.abi, rewardPoolAddress)) as MultiRewardPool;
    const fundingTxn = await rewardPool.connect(rewardFunder).notifyRewardAmount(rewardTokenAddress, TEN);
    const fundingReceipt = await fundingTxn.wait();
    const fundingSuccess = fundingReceipt.status === 1;

    console.log('Completed notifyRewards: ' + fundingSuccess);
  }
}

// ----- Run the script ------ //
const networkParameters = deploymentParamMap.get(network.name);
const rewardPoolAddress = rewardPoolAddressMap.get(network.name);
if (networkParameters && rewardPoolAddress) {
  fundRewardPool(networkParameters.rewardTokenAddress, rewardPoolAddress)
    .then(() => process.exit(0))
    .catch((e) => {
      console.log(e);
      process.exit(1);
    });
} else {
  console.log('Unable to find parameters for network: ' + network.name);
  process.exit(1);
}
