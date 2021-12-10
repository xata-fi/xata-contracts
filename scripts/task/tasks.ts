import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import dotenv from 'dotenv';
dotenv.config();

import { utils, BigNumber } from 'ethers';
const { keccak256, solidityPack, toUtf8Bytes } = utils;

import { CREATE2, ROUTER_ADDRESS, FACTORY_ADDRESS, ROUTER_SALT, FACTORY_SALT } from '../../lib/constants';
import { encodeRouterConstructor, encodeFactoryConstructor } from '../../lib/constructorEncoder';
import { encodeTransferOwnership } from '../../lib/functionSig';

import { ROUTER_HASH, FACTORY_HASH, CREATE2_HASH } from '../../lib/bytecode';

function checkHreNetwork(hre: HardhatRuntimeEnvironment): void {
  const networkName = hre.network.name;
  const networkIsTenderly =
    networkName === 'eth_tenderly' || networkName === 'bsc_tenderly' || networkName === 'matic_tenderly';
  const networkIsMain =
    networkName === 'eth' ||
    networkName === 'bsc' ||
    networkName === 'matic' ||
    networkName === 'arbitrum' ||
    networkName === 'moonriver';
  if (!networkIsMain && !networkIsTenderly) {
    throw new Error('Unsupported network!');
  }
}

task('accounts', 'Print the list of accounts', async (args, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

task('assign-owner', 'Transfer the ownership of an implementation contract to a designated address')
  .addParam('addr', 'REQUIRED: the implementation address')
  .addParam('owner', 'REQUIRED: the owner address')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const deployer = (await hre.ethers.getSigners())[1];
    const implementationAddr = args.addr as string;
    const ownerAddr = args.owner as string;

    const deployerContract = await hre.ethers.getContractAt('Deployer', CREATE2);
    const transferOwnershipData = encodeTransferOwnership(ownerAddr);
    const estimatedGasLimit = await deployerContract
      .connect(deployer)
      .estimateGas.functionCall(implementationAddr, transferOwnershipData);
    const gasLimit = args.gaslimit || estimatedGasLimit;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await deployerContract
        .connect(deployer)
        .functionCall(implementationAddr, transferOwnershipData, { gasPrice: gasPrice, gasLimit: gasLimit });
      const receipt = await tx.wait(1);
      console.log(`Owner of ${implementationAddr} has been transferred to ${ownerAddr}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

task('add-relayer', 'Adds an authorized relayer')
  .addOptionalParam('addr', 'OPTIONAL: the relayer address. Defaults at GEODE_RELAYER address')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const owner = (await hre.ethers.getSigners())[0];

    const relayerAddr = args.addr || process.env.RELAYER!;
    const routerContract = await hre.ethers.getContractAt('ConveyorV2Router01', ROUTER_ADDRESS);
    const estimatedGas = await routerContract.connect(owner).estimateGas.setRelayer(relayerAddr, true);
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await routerContract
        .connect(owner)
        .setRelayer(relayerAddr, true, { gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      console.log(`${relayerAddr} relayer status: ${true}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

task('remove-relayer', 'Remove a relayer')
  .addOptionalParam('addr', 'OPTIONAL: the relayer address. Defaults at GEODE_RELAYER address')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);

    const owner = (await hre.ethers.getSigners())[0];

    const relayerAddr = args.addr || process.env.RELAYER!;
    const routerContract = await hre.ethers.getContractAt('ConveyorV2Router01', ROUTER_ADDRESS);
    const estimatedGas = await routerContract.connect(owner).estimateGas.setRelayer(relayerAddr, false);
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await routerContract
        .connect(owner)
        .setRelayer(relayerAddr, false, { gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      console.log(`${relayerAddr} relayer status: ${false}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

task('set-router', 'Configure the router address in the factory')
  .addParam('router', 'REQUIRED: The router address')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const owner = (await hre.ethers.getSigners())[0];
    const routerAddr = args.router!;
    const factoryContract = await hre.ethers.getContractAt('ConveyorV2Factory', FACTORY_ADDRESS);
    const estimatedGas = await factoryContract.connect(owner).estimateGas.setRouter(routerAddr);
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await factoryContract.connect(owner).setRouter(routerAddr, { gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      console.log(`Factory address: ${factoryContract.address}`);
      console.log(`Router address set to ${routerAddr}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

task('set-gas-fee-holder', 'Configures an address for collecting gas fee')
  .addOptionalParam('addr', 'OPTIONAL: the gas fee holder. Defaults at the owner address')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const owner = (await hre.ethers.getSigners())[0];
    const routerContract = await hre.ethers.getContractAt('ConveyorV2Router01', ROUTER_ADDRESS);
    const feeHolderAddr = args.addr || owner.address;
    const estimatedGas = await routerContract.connect(owner).estimateGas.setFeeHolder(feeHolderAddr);
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await routerContract
        .connect(owner)
        .setFeeHolder(feeHolderAddr, { gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      console.log(`assigned gas fee holder privilege to ${feeHolderAddr}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

task('set-constant-gas', 'Sets the constant base gas, defaults at 21000')
  .addOptionalParam('gas', 'The base gas usage')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const owner = (await hre.ethers.getSigners())[0];
    const routerContract = await hre.ethers.getContractAt('ConveyorV2Router01', ROUTER_ADDRESS);
    const argGas = args.gas || '21000';
    const estimatedGas = await routerContract.connect(owner).estimateGas.setConstantFee(argGas);
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await routerContract.connect(owner).setConstantFee(argGas, { gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      console.log(`Constant gas set to ${argGas}`);
      console.log(`Set by: ${owner.address} on Router: ${ROUTER_ADDRESS}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

task('set-transfer-gas', 'Sets the transfer gas, defaults at 65000')
  .addOptionalParam('gas', 'The transfer gas usage')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const owner = (await hre.ethers.getSigners())[0];
    const routerContract = await hre.ethers.getContractAt('ConveyorV2Router01', ROUTER_ADDRESS);
    const argGas = args.gas || '65000';
    const estimatedGas = await routerContract.connect(owner).estimateGas.setTransferFee(argGas);
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await routerContract.connect(owner).setTransferFee(argGas, { gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      console.log(`Transfer gas set to ${argGas}`);
      console.log(`Set by: ${owner.address} on Router: ${ROUTER_ADDRESS}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

task('meta', 'Toggles meta-transaction')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const owner = (await hre.ethers.getSigners())[0];
    const routerContract = await hre.ethers.getContractAt('ConveyorV2Router01', ROUTER_ADDRESS);
    const estimatedGas = await routerContract.connect(owner).estimateGas.metaSwitch();
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await routerContract.connect(owner).metaSwitch({ gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      const metaEnabled = await routerContract.metaEnabled();
      console.log(`Meta-transaction ${metaEnabled ? 'enabled' : 'disabled'}`);
      console.log(`Set by: ${owner.address} on Router: ${ROUTER_ADDRESS}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

// deploy new factory
task('deploy-factory', 'Deploy a factory')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const [owner, deployer] = await hre.ethers.getSigners();

    const contractFactory = await hre.ethers.getContractFactory('ConveyorV2Factory');
    const factoryBytecode = contractFactory.bytecode;

    const factoryHash = keccak256(toUtf8Bytes(factoryBytecode));
    if (factoryHash != FACTORY_HASH) {
      throw new Error('Compiled bytecode does not match with expected bytecode.');
    }

    const factoryInitCode = encodeFactoryConstructor(owner.address);
    const hashedBytecode = keccak256(solidityPack(['bytes', 'bytes'], [factoryBytecode, factoryInitCode]));

    const create2 = await hre.ethers.getContractAt('Deployer', CREATE2);
    const computed_addr = await create2.computeAddress(FACTORY_SALT, hashedBytecode, CREATE2);

    const estimatedGas = await create2
      .connect(deployer)
      .estimateGas.deploy(factoryBytecode, factoryInitCode, FACTORY_SALT);
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await create2
        .connect(deployer)
        .deploy(factoryBytecode, factoryInitCode, FACTORY_SALT, { gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      console.log(`Deployed factory at ${computed_addr}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

// deploy new router
task('deploy-router', 'Deploy a new router')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const deployer = (await hre.ethers.getSigners())[1];
    const routerFactory = await hre.ethers.getContractFactory('ConveyorV2Router01');
    const routerBytecode = routerFactory.bytecode;

    const routerHash = keccak256(toUtf8Bytes(routerBytecode));
    if (routerHash != ROUTER_HASH) {
      throw new Error('Compiled bytecode does not match with expected bytecode.');
    }

    const routerInitcode = encodeRouterConstructor(FACTORY_ADDRESS);
    const hashedBytecode = keccak256(solidityPack(['bytes', 'bytes'], [routerBytecode, routerInitcode]));

    const create2 = await hre.ethers.getContractAt('Deployer', CREATE2);
    const computed_addr = await create2.computeAddress(ROUTER_SALT, hashedBytecode, CREATE2);

    const estimatedGas = await create2
      .connect(deployer)
      .estimateGas.deploy(routerBytecode, routerInitcode, ROUTER_SALT);
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await create2
        .connect(deployer)
        .deploy(routerBytecode, routerInitcode, ROUTER_SALT, { gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      console.log(`Deployed router at ${computed_addr}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

// factory settings - set protocol fee
task('set-fee-to', 'Sets the fee-to address - the recipient of mintFee')
  .addParam('address', 'REQUIRED: The address to set as fee-to')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);
    const owner = (await hre.ethers.getSigners())[0];
    const factoryContract = await hre.ethers.getContractAt('ConveyorV2Factory', FACTORY_ADDRESS);

    const estimatedGas = await factoryContract.connect(owner).estimateGas.setFeeTo(args.address!);
    const gasLimit = args.gaslimit || estimatedGas;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const tx = await factoryContract
        .connect(owner)
        .setFeeTo(args.address!, { gasLimit: gasLimit, gasPrice: gasPrice });
      const receipt = await tx.wait(1);
      console.log(`Fee-to set to ${args.address}`);
      console.log(`Set by: ${owner.address} on Factory: ${FACTORY_ADDRESS}`);
      console.log(`tx: ${receipt.transactionHash}`);
    } catch (e) {
      console.error(e);
    }
  });

task('create2', 'Deploy the CREATE2 contract')
  .addOptionalParam('gaslimit', 'OPTIONAL: the gas limit')
  .addOptionalParam('gasprice', 'OPTIONAL: the gas price')
  .setAction(async (args, hre: HardhatRuntimeEnvironment) => {
    checkHreNetwork(hre);

    const deployer = (await hre.ethers.getSigners())[1];

    const create2Factory = await hre.ethers.getContractFactory('Deployer');
    const create2Bytecode = create2Factory.bytecode;
    const hash = keccak256(toUtf8Bytes(create2Bytecode));
    if (hash != CREATE2_HASH) {
      throw new Error('Compiled bytecode does not match with expected bytecode.');
    }

    const gasLimit = args.gaslimit ? BigNumber.from(args.gaslimit) : undefined;
    const gasPrice = args.gasprice ? BigNumber.from(args.gasprice) : await hre.ethers.provider.getGasPrice();

    try {
      const create2Instance = await create2Factory.connect(deployer).deploy({ gasLimit: gasLimit, gasPrice: gasPrice });
      await create2Instance.deployed();
      const deploymentTx = create2Instance.deployTransaction;
      console.log('CREATE2 deployed succesfully at ', create2Instance.address);
      console.log('tx: ', deploymentTx.hash);
    } catch (e) {
      console.error(e);
    }
  });
