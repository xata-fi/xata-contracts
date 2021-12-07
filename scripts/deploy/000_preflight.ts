import { network, ethers } from 'hardhat';
import { printDeploymentLogs, getAccounts } from '../../lib/utils';
import { Deployer__factory, Deployer, ConveyorV2Factory__factory, ConveyorV2Router01__factory } from '../../typechain';
import { CREATE2_HASH, FACTORY_HASH, ROUTER_HASH } from '../../lib/bytecode';
import { utils } from 'ethers';

const { keccak256, toUtf8Bytes } = utils;

export default async function readConfigAndVerifyBytecode(): Promise<void> {
  console.log(`======================== Network ============================`);
  console.log(`name: ${network.name}`);
  console.log(`=============================================================`);

  const factoryFactory = (await ethers.getContractFactory('ConveyorV2Factory')) as ConveyorV2Factory__factory;
  const factoryBytecode = factoryFactory.bytecode;
  const routerFactory = (await ethers.getContractFactory('ConveyorV2Router01')) as ConveyorV2Router01__factory;
  const routerBytecode = routerFactory.bytecode;

  const factoryHash = keccak256(toUtf8Bytes(factoryBytecode));
  const routerHash = keccak256(toUtf8Bytes(routerBytecode));
  if (routerHash != ROUTER_HASH || factoryHash != FACTORY_HASH) {
    throw new Error('Compiled bytecode does not match with expected bytecode.');
  }
}

export async function deployCreate2(verbose = false): Promise<Deployer> {
  const name = 'Deployer';
  const { deployer } = await getAccounts();
  const factory = (await ethers.getContractFactory(name)) as Deployer__factory;
  const create2Bytecode = factory.bytecode;
  const hash = keccak256(toUtf8Bytes(create2Bytecode));
  if (hash != CREATE2_HASH) {
    throw new Error('Compiled bytecode does not match with expected bytecode.');
  }
  const instance = (await factory.connect(deployer).deploy()) as Deployer;
  await instance.deployed();
  const deploymentTx = instance.deployTransaction;
  if (verbose) {
    printDeploymentLogs(name, instance.address, deploymentTx.hash);
  }
  return instance;
}
