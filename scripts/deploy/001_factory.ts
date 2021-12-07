import { ethers } from 'hardhat';
import { ConveyorV2Factory__factory, ConveyorV2Factory, Deployer } from '../../typechain';
import { getAccounts, printDeploymentLogs } from '../../lib/utils';
import { encodeFactoryConstructor } from '../../lib/constructorEncoder';
import { FACTORY_SALT } from '../../lib/constants';
import { utils } from 'ethers';
const { keccak256, solidityPack, toUtf8Bytes } = utils;

export default async function deployFactory(deployerContract: Deployer, verbose = false): Promise<ConveyorV2Factory> {
  const name = 'ConveyorV2Factory';
  const { deployer, owner } = await getAccounts();
  const factoryFactory = (await ethers.getContractFactory(name)) as ConveyorV2Factory__factory;
  const factoryBytecode = factoryFactory.bytecode;
  const factoryInitcode = encodeFactoryConstructor(owner.address);
  const hashedBytecode = keccak256(solidityPack(['bytes', 'bytes'], [factoryBytecode, factoryInitcode]));
  const deploymentTx = await deployerContract.connect(deployer).deploy(factoryBytecode, factoryInitcode, FACTORY_SALT, {
    gasLimit: '10000000',
  });
  const factoryAddress = await deployerContract.computeAddress(FACTORY_SALT, hashedBytecode, deployerContract.address);
  const factory = (await ethers.getContractAt(name, factoryAddress)) as ConveyorV2Factory;
  if (verbose) {
    printDeploymentLogs(name, factoryAddress, deploymentTx.hash);
  }
  return factory;
}
