import { ethers } from 'hardhat';
import chai, { use } from 'chai';
import { constants } from 'ethers';
import { resetNetwork, getAccounts } from '../lib/utils';
import { solidity } from 'ethereum-waffle';
import { DAI_ERC20, USDC_ERC20 } from '../lib/constants';
import deployFactory from '../scripts/deploy/001_factory';
import { deployCreate2 } from '../scripts/deploy/000_preflight';
import { ConveyorV2Factory, ConveyorV2Pair, Deployer } from '../typechain';
import { pair } from '../lib/pair';

use(solidity);
const { expect } = chai;

describe('ConveyorV2Factory', () => {
  let factory: ConveyorV2Factory;
  let create2: Deployer;

  before(async () => {
    await resetNetwork();
    create2 = await deployCreate2();
    factory = await deployFactory(create2);
  });

  it('feeToSetter, feeTo, allPairsLength', async () => {
    const { owner } = await getAccounts();
    const addr = owner.address;
    const zero_addr = constants.AddressZero;
    const feeToSetter_addr = await factory.feeToSetter();
    expect(feeToSetter_addr).to.eq(addr);
    const feeTo_addr = await factory.feeTo();
    expect(feeTo_addr).to.eq(zero_addr);
    const pair_len = await factory.allPairsLength();
    expect(pair_len).to.eq(0);
  });

  it('unauthorized: setFeeTo, setFeeToSetter, setRouter', async () => {
    const { user } = await getAccounts();
    const message = 'ConveyorV2: FORBIDDEN';
    await expect(factory.connect(user).setFeeTo(user.address)).to.revertedWith(message);
    await expect(factory.connect(user).setFeeToSetter(user.address)).to.revertedWith(message);
    await expect(factory.connect(user).setRouter(user.address)).to.revertedWith(message);
  });

  it('authorized: setFeeTo, setFeeToSetter, setRouter', async () => {
    const { owner } = await getAccounts();
    const feeToSetter = owner;
    await factory.connect(feeToSetter).setFeeTo(feeToSetter.address);
    await factory.connect(feeToSetter).setFeeToSetter(feeToSetter.address);
    await factory.connect(feeToSetter).setRouter(feeToSetter.address);
    const router_addr = await factory.router();
    const feeTo_addr = await factory.feeTo();
    const feeToSetter_addr = await factory.feeToSetter();
    expect(router_addr).to.eq(feeToSetter.address);
    expect(feeTo_addr).to.eq(feeToSetter.address);
    expect(feeToSetter_addr).to.eq(feeToSetter.address);
  });

  it('should create pair', async () => {
    const computed_pairAddr = await pair(USDC_ERC20, DAI_ERC20, factory.address);
    await factory.createPair(USDC_ERC20, DAI_ERC20);
    const pair_len = await factory.allPairsLength();
    expect(pair_len).to.eq(1);
    const actual_pairAddr = (await factory.getPair(USDC_ERC20, DAI_ERC20)).toLowerCase();
    expect(actual_pairAddr).to.eq(computed_pairAddr);
  });

  it('should load pair info', async () => {
    const computed_pairAddr = await pair(USDC_ERC20, DAI_ERC20, factory.address);
    const pairInstance = (await ethers.getContractAt('ConveyorV2Pair', computed_pairAddr)) as ConveyorV2Pair;
    expect(await pairInstance.token0()).to.eq(DAI_ERC20);
    expect(await pairInstance.token1()).to.eq(USDC_ERC20);
    expect(await pairInstance.name()).to.eq('Conveyor V2');
    expect(await pairInstance.symbol()).to.eq('CON-V2');
    expect(await pairInstance.decimals()).to.eq(18);
  });
});
