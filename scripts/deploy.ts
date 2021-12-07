import readConfigAndVerifyBytecode, { deployCreate2 } from './deploy/000_preflight';
import deployFactory from './deploy/001_factory';
import deployRouter from './deploy/002_router';
import {
  setRouter,
  setRelayer,
  getAccounts,
  networkIsLocal,
  networkIsTenderly,
  networkIsMain,
  setFeeTo,
  setFeeHolder,
  transferOwnership,
} from '../lib/utils';
import { Deployer } from '../typechain';
import { ethers } from 'hardhat';
import { CREATE2 } from '../lib/constants';

async function main() {
  const { relayer, geodeRelayer, owner } = await getAccounts();
  await readConfigAndVerifyBytecode();
  const create2: Deployer = await getCreate2();
  const factory = await deployFactory(create2, true);
  const router = await deployRouter(create2, factory.address, true);
  if (networkIsLocal) {
    // await setFeeTo(factory, owner.address);
    await transferOwnership(create2, router.address, owner.address, true);
    await setRouter(factory, router.address);
    const relayerAddr = networkIsLocal ? relayer.address : geodeRelayer!;
    await setRelayer(router, relayerAddr, true);
    await setFeeHolder(router, owner.address);
  }
}

async function getCreate2(): Promise<Deployer> {
  console.log('Loading CREATE2 deployer...');
  if (!networkIsLocal) {
    return (await ethers.getContractAt('Deployer', CREATE2)) as Deployer;
  } else {
    const create2 = await deployCreate2();
    console.log('Local create2 deployed at ', create2.address);
    return create2;
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(e);
    process.exit(1);
  });
