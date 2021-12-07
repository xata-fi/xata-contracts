import { ethers } from 'hardhat';
import { utils, BigNumber } from 'ethers';
const { keccak256, toUtf8Bytes, solidityPack } = utils;
import chai, { use } from 'chai';
import { solidity } from 'ethereum-waffle';
import { Deployer, Greeter, Greeter__factory } from '../typechain';
import { resetNetwork, getAccounts } from '../lib/utils';
import { deployCreate2 } from '../scripts/deploy/000_preflight';
import { encodeGreeterConstrustor } from '../lib/constructorEncoder';
import { encodeSetGreeter } from '../lib/functionSig';

use(solidity);
const { expect } = chai;
let create2: Deployer;
const greeterSalt = keccak256(toUtf8Bytes('Greeter'));
const message = 'Hello, CREATE2';
let create2Addr: string;

// resets the network and deploys the create2 contract
async function loadCreate2(): Promise<void> {
  create2 = await deployCreate2();
  create2Addr = create2.address;
}

async function greeterPackedBytecode(): Promise<{ bytecode: string; data: string; hash: string }> {
  const greeterFactory = (await ethers.getContractFactory('Greeter')) as Greeter__factory;
  const bytecode = greeterFactory.bytecode;
  const { relayer } = await getAccounts();
  const data = encodeGreeterConstrustor(message, relayer.address);
  const hash = keccak256(solidityPack(['bytes', 'bytes'], [bytecode, data]));
  return { bytecode, data, hash };
}

describe('Deploy Greeter with CREATE2', () => {
  let address: string;

  it('should withdraw funds', async () => {
    const { deployer } = await getAccounts();
    const expected_address = '0x1aB97fB39D63236626732126584A206f60ab40e6';
    await resetNetwork();

    expect(await ethers.provider.getBalance(expected_address)).to.eq(0);

    // send eth to the deployer contract
    const amount = BigNumber.from('42069');
    await deployer.sendTransaction({
      to: expected_address,
      value: amount,
    });

    expect(await ethers.provider.getBalance(expected_address)).to.eq(amount);

    await loadCreate2();

    expect(expected_address).to.eq(create2.address);

    expect(await ethers.provider.getBalance(create2.address)).to.eq(amount);

    const create2_bal_before = await ethers.provider.getBalance(create2.address);
    expect(create2_bal_before).to.eq(amount);

    // withdraw funds
    await create2.connect(deployer).withdraw(create2_bal_before);
    const create2_bal_after = await ethers.provider.getBalance(create2.address);
    expect(create2_bal_after).to.eq(0);
  });

  it('should deploy Greeter using CREATE2 with the correct address', async () => {
    await resetNetwork();
    await loadCreate2();
    const { bytecode, data, hash } = await greeterPackedBytecode();
    const expected_address = await create2.computeAddress(greeterSalt, hash, create2.address);
    address = expected_address;

    // deploy greeter
    await create2.deploy(bytecode, data, greeterSalt);
    const filter = create2.filters.ContractDeployed();
    const event = await create2.queryFilter(filter, 'latest');
    const actual_address = event[0].args[0];

    // console.log(expected_address);
    // console.log(actual_address);
    expect(address).to.eq(actual_address);

    // check greeter message
    const greeter = (await ethers.getContractAt('Greeter', address)) as Greeter;
    expect(await greeter.greet()).to.eq(message);
  });

  it('should deploy Greeter to a different network with the same address', async () => {
    const jsonRpcUrl = 'https://rpc-mainnet.maticvigil.com';
    await resetNetwork(jsonRpcUrl, true);
    await loadCreate2();

    const { bytecode, data, hash } = await greeterPackedBytecode();

    // deploy greeter
    await create2.deploy(bytecode, data, greeterSalt);
    const filter = create2.filters.ContractDeployed();
    const event = await create2.queryFilter(filter, 'latest');
    const actual_address = event[0].args[0];

    // console.log(expected_address);
    // console.log(actual_address);
    expect(address).to.eq(actual_address);
  });

  it('should perform a function call', async () => {
    await create2.functionCall(address, encodeSetGreeter('Yooooo'));
    // check greeter message
    const greeter = (await ethers.getContractAt('Greeter', address)) as Greeter;
    expect(await greeter.greet()).to.eq('Yooooo');
  });

  it('should not allow unauthorized caller to perform a function call', async () => {
    const { user } = await getAccounts();
    const tx = create2.connect(user).functionCall(address, encodeSetGreeter('Yo momma is fat'));
    await expect(tx).to.revertedWith('Ownable: caller is not the owner');
  });
});
