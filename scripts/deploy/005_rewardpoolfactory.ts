import { network, ethers } from 'hardhat';
import { printDeploymentLogs, getAccounts } from '../../lib/utils';
import { RewardPoolReceiverFactory__factory, RewardPoolReceiverFactory } from '../../typechain';
import { REWARD_POOL_FACTORY_HASH } from '../../lib/bytecode';
import { utils } from 'ethers';

const { keccak256, toUtf8Bytes } = utils;

export async function deployRewardPoolFactory(verbose = false): Promise<RewardPoolReceiverFactory> {
  const name = 'RewardPoolReceiverFactory';
  const { deployer, owner } = await getAccounts();
  const rewardPoolFactory = (await ethers.getContractFactory(name)) as RewardPoolReceiverFactory__factory;
  const create2Bytecode = rewardPoolFactory.bytecode;
  const hash = keccak256(toUtf8Bytes(create2Bytecode));
  console.log('RewardPoolReceiverFactoryHash: ' + hash);
  if (hash !== REWARD_POOL_FACTORY_HASH) {
    throw new Error(`Compiled bytecode [${hash}] does not match with expected bytecode [${REWARD_POOL_FACTORY_HASH}].`);
  }
  const instance = (await rewardPoolFactory.connect(deployer).deploy()) as RewardPoolReceiverFactory;
  await instance.deployed();
  await instance.setDefaultDev(owner.address);
  const deploymentTx = instance.deployTransaction;
  if (verbose) {
    printDeploymentLogs(name, instance.address, deploymentTx.hash);
  }
  return instance;
}

deployRewardPoolFactory(true)
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });
