import { ethers } from 'hardhat';
import { ConveyorV2Router01__factory, ConveyorV2Router01, Deployer } from '../../typechain';
import { getAccounts, printDeploymentLogs } from '../../lib/utils';
import { encodeRouterConstructor } from '../../lib/constructorEncoder';
import { ROUTER_SALT } from '../../lib/constants';
import { utils } from 'ethers';
const { keccak256, solidityPack, toUtf8Bytes } = utils;

export default async function deployRouter(
  deployerContract: Deployer,
  factoryAddr: string,
  verbose = false,
): Promise<ConveyorV2Router01> {
  const name = 'ConveyorV2Router01';
  const { deployer, owner } = await getAccounts();
  const routerFactory = (await ethers.getContractFactory(name)) as ConveyorV2Router01__factory;
  const routerBytecode = routerFactory.bytecode;
  const routerInitcode = encodeRouterConstructor(factoryAddr);
  const hashedBytecode = keccak256(solidityPack(['bytes', 'bytes'], [routerBytecode, routerInitcode]));
  const deploymentTx = await deployerContract.connect(deployer).deploy(routerBytecode, routerInitcode, ROUTER_SALT, {
    gasLimit: '10000000',
  });
  const routerAddress = await deployerContract.computeAddress(ROUTER_SALT, hashedBytecode, deployerContract.address);
  const router = (await ethers.getContractAt(name, routerAddress)) as ConveyorV2Router01;
  if (verbose) {
    printDeploymentLogs(name, routerAddress, deploymentTx.hash);
  }
  return router;
}
