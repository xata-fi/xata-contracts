import { ethers } from 'hardhat';
import chai, { use } from 'chai';
import { constants, BigNumber, Contract, Signature } from 'ethers';
import {
  resetNetwork,
  getAccounts,
  loadERC20instance,
  sinceNow,
  formatERC20Amount,
  transferOwnership,
} from '../../lib/utils';
import { AddLiquidityType, SwapType, PermitType, RemoveLiquidityType } from '../../lib/types';
import { solidity } from 'ethereum-waffle';
import { DAI_ERC20, USDC_ERC20, USDT_ERC20 } from '../../lib/constants';
import deployFactory from '../../scripts/deploy/001_factory';
import deployRouter from '../../scripts/deploy/002_router';
import fundERC20ToUser from '../../scripts/local/000_fund';
import addLiquidity from '../../scripts/local/001_addLiquidity';
import { deployCreate2 } from '../../scripts/deploy/000_preflight';
import { ConveyorV2Factory, ConveyorV2Router01, ConveyorV2Pair, Deployer } from '../../typechain';
import * as eip712 from '../../lib/eip712';
import { ChainId, Token } from '@uniswap/sdk';
import { getArgumentsForSwapExactTokensForTokens, getArgumentsForSwapTokensForExactTokens } from '../../lib/sdk';

use(solidity);
const { expect } = chai;
let factory: ConveyorV2Factory;
let router: ConveyorV2Router01;
let create2: Deployer;
let dai: Contract;
let usdc: Contract;
let usdt: Contract;

async function loadDeployment() {
  await resetNetwork();
  create2 = await deployCreate2();
  factory = await deployFactory(create2);
  router = await deployRouter(create2, factory.address);
  dai = await loadERC20instance(DAI_ERC20);
  usdc = await loadERC20instance(USDC_ERC20);
  usdt = await loadERC20instance(USDT_ERC20);
  await factory.setRouter(router.address);
}

describe('ConveyorV2Router01: deployment', () => {
  before(async () => {
    await loadDeployment();
  });

  it('should transfer ownership', async () => {
    const { owner, deployer } = await getAccounts();
    await transferOwnership(create2, router.address, owner.address);
    const routerOwner = await router.owner();
    const create2Owner = await create2.owner();
    expect(routerOwner).to.equal(owner.address);
    expect(create2Owner).to.equal(deployer.address);
  });

  it('should set relayer', async () => {
    const { relayer } = await getAccounts();
    expect(await router.relayers(relayer.address)).to.eq(false);
    await router.setRelayer(relayer.address, true);
    expect(await router.relayers(relayer.address)).to.eq(true);
  });

  it('should catch unauthorized setting relayers attempt', async () => {
    const zero = constants.AddressZero;
    const { user } = await getAccounts();
    await expect(router.connect(user).setRelayer(zero, true)).to.revertedWith('Ownable: caller is not the owner');
    expect(await router.relayers(zero)).to.eq(false);
  });

  it('factory', async () => {
    expect(await router.factory()).to.eq(factory.address);
  });

  it('should enable meta-tx by default', async () => {
    expect(await router.metaEnabled()).to.eq(true);
  });

  it('should disable meta-tx', async () => {
    await router.metaSwitch();
    expect(await router.metaEnabled()).to.eq(false);
  });
});

describe('ConveyorV2Router01: add and remove liquidity', () => {
  const minAmount = BigNumber.from(200);
  const desiredAmount = BigNumber.from(500);
  let min_dai: BigNumber;
  let min_usdc: BigNumber;
  let desired_dai: BigNumber;
  let desired_usdc: BigNumber;
  let liquidity_object: AddLiquidityType;

  before(async () => {
    const { user } = await getAccounts();
    await fundERC20ToUser(user.address, BigNumber.from(1000));
    min_dai = formatERC20Amount(minAmount, await dai.decimals());
    desired_dai = formatERC20Amount(desiredAmount, await dai.decimals());
    min_usdc = formatERC20Amount(minAmount, await usdc.decimals());
    desired_usdc = formatERC20Amount(desiredAmount, await usdc.decimals());
    liquidity_object = {
      tokenA: DAI_ERC20,
      tokenB: USDC_ERC20,
      amountADesired: desired_dai,
      amountBDesired: desired_usdc,
      amountAMin: min_dai,
      amountBMin: min_usdc,
      user: user.address,
      deadline: sinceNow(3600),
    };
  });

  it('should add liquidity', async () => {
    const { user, owner } = await getAccounts();
    const max = '1000000000000000000000000000000';
    await dai.connect(user).approve(router.address, BigNumber.from(max));
    await usdc.connect(user).approve(router.address, BigNumber.from(max));
    const dai_before = await dai.balanceOf(owner.address);
    expect(dai_before).to.eq(0);
    const tx = await router.connect(user).addLiquidity(liquidity_object);
    const receipt = await tx.wait();
    console.log('add liquidity gas: ', receipt.gasUsed.toString());
    const pairAddress = await factory.getPair(USDC_ERC20, DAI_ERC20);
    const LP = (await ethers.getContractAt('ConveyorV2Pair', pairAddress)) as ConveyorV2Pair;
    expect(await LP.balanceOf(user.address)).to.gt(0);
    expect(await dai.balanceOf(pairAddress)).to.eq(desired_dai);
    expect(await usdc.balanceOf(pairAddress)).to.eq(desired_usdc);
  });

  it('should remove liquidity', async () => {
    const { user } = await getAccounts();
    const pairAddress = await factory.getPair(USDC_ERC20, DAI_ERC20);
    const LP = (await ethers.getContractAt('ConveyorV2Pair', pairAddress)) as ConveyorV2Pair;
    const liquidity = await LP.balanceOf(user.address);
    const nonce = await LP.nonces(user.address);
    const domain = eip712.getDomain(pairAddress, 1, 'Conveyor V2');
    const permit_struct: PermitType = {
      owner: user.address,
      spender: router.address,
      value: liquidity,
      deadline: sinceNow(3600),
    };
    const removeLiquidity_struct: RemoveLiquidityType = {
      tokenA: DAI_ERC20,
      tokenB: USDC_ERC20,
      liquidity: liquidity,
      amountAMin: min_dai,
      amountBMin: min_usdc,
      user: user.address,
      deadline: sinceNow(3600),
    };
    const message = eip712.getPermitMessage(permit_struct, nonce);
    const sig = await eip712.signEIP712(user, domain, eip712.EIP712PermitType, message);
    const tx = await router.connect(user).removeLiquidityWithPermit(removeLiquidity_struct, sig);
    const receipt = await tx.wait();
    console.log('remove liquidity gas: ', receipt.gasUsed.toString());
    expect(await LP.balanceOf(user.address)).to.gte(0);
    expect(await dai.balanceOf(pairAddress)).to.gte(0);
    expect(await usdc.balanceOf(pairAddress)).to.gte(0);
  });
});

describe('ConveyorV2Router01: swap - single hop', () => {
  before(async () => {
    const { user, owner } = await getAccounts();
    await loadDeployment();
    await transferOwnership(create2, router.address, owner.address);
    await router.metaSwitch();
    await fundERC20ToUser(user.address, BigNumber.from(1000));
    await addLiquidity(router, USDC_ERC20, DAI_ERC20, BigNumber.from(100), BigNumber.from(200), 3600);
  });

  it('swapExactTokensForTokens', async () => {
    const { user } = await getAccounts();
    const dai_decimals = (await dai.decimals()).toString();
    const usdc_decimals = (await usdc.decimals()).toString();
    const DAI = new Token(ChainId.MAINNET, DAI_ERC20, parseInt(dai_decimals));
    const USDC = new Token(ChainId.MAINNET, USDC_ERC20, parseInt(usdc_decimals));

    const inputAmount = formatERC20Amount(BigNumber.from(20), parseInt(dai_decimals));
    const path = [DAI_ERC20, USDC_ERC20];
    const { amountOutMin } = await getArgumentsForSwapExactTokensForTokens([DAI, USDC], inputAmount, factory.address);

    const swap_object: SwapType = {
      amount0: inputAmount,
      amount1: amountOutMin,
      path: path,
      user: user.address,
      deadline: sinceNow(3600),
    };
    const usdc_bal_before = await usdc.balanceOf(user.address);
    const tx = await router.connect(user).swapExactTokensForTokens(swap_object);
    const receipt = await tx.wait();
    console.log('swapExactForTokens gas: ', receipt.gasUsed.toString());
    const usdc_bal_after = await usdc.balanceOf(user.address);
    expect(usdc_bal_after).to.gt(usdc_bal_before);
  });

  it('swapTokensForExactTokens', async () => {
    const { user } = await getAccounts();
    const dai_decimals = (await dai.decimals()).toString();
    const usdc_decimals = (await usdc.decimals()).toString();
    const DAI = new Token(ChainId.MAINNET, DAI_ERC20, parseInt(dai_decimals));
    const USDC = new Token(ChainId.MAINNET, USDC_ERC20, parseInt(usdc_decimals));

    const outputAmount = formatERC20Amount(BigNumber.from(20), parseInt(dai_decimals));
    const path = [USDC_ERC20, DAI_ERC20];
    const { amountInMax } = await getArgumentsForSwapTokensForExactTokens([USDC, DAI], outputAmount, factory.address);

    const swap_object: SwapType = {
      amount0: outputAmount,
      amount1: amountInMax,
      path: path,
      user: user.address,
      deadline: sinceNow(3600),
    };

    const dai_bal_before = await dai.balanceOf(user.address);
    const tx = await router.connect(user).swapTokensForExactTokens(swap_object);
    const receipt = await tx.wait();
    console.log('swapTokensForExactTokens gas: ', receipt.gasUsed.toString());
    const dai_bal_after = await dai.balanceOf(user.address);
    expect(dai_bal_after).to.gt(dai_bal_before);
  });
});

describe('ConveyorV2Router01: swap - multi hop', () => {
  before(async () => {
    const { user, owner } = await getAccounts();
    await loadDeployment();
    await transferOwnership(create2, router.address, owner.address);
    await router.metaSwitch();
    await fundERC20ToUser(user.address, BigNumber.from(1000));
    await addLiquidity(router, USDC_ERC20, DAI_ERC20, BigNumber.from(100), BigNumber.from(200), 3600);
    await addLiquidity(router, USDC_ERC20, USDT_ERC20, BigNumber.from(100), BigNumber.from(200), 3600);
  });

  it('swapExactTokensForTokens', async () => {
    const { user } = await getAccounts();
    const dai_decimals = (await dai.decimals()).toString();
    const usdc_decimals = (await usdc.decimals()).toString();
    const usdt_decimals = (await usdt.decimals()).toString();
    const DAI = new Token(ChainId.MAINNET, DAI_ERC20, parseInt(dai_decimals));
    const USDC = new Token(ChainId.MAINNET, USDC_ERC20, parseInt(usdc_decimals));
    const USDT = new Token(ChainId.MAINNET, USDT_ERC20, parseInt(usdt_decimals));

    const inputAmount = formatERC20Amount(BigNumber.from(20), parseInt(dai_decimals));
    const path = [DAI_ERC20, USDC_ERC20, USDT_ERC20];
    const { amountOutMin } = await getArgumentsForSwapExactTokensForTokens(
      [DAI, USDC, USDT],
      inputAmount,
      factory.address,
    );

    const swap_object: SwapType = {
      amount0: inputAmount,
      amount1: amountOutMin,
      path: path,
      user: user.address,
      deadline: sinceNow(3600),
    };

    const usdc_bal_before = await usdc.balanceOf(user.address);
    const usdt_bal_before = await usdt.balanceOf(user.address);
    await router.connect(user).swapExactTokensForTokens(swap_object);
    const usdc_bal_after = await usdc.balanceOf(user.address);
    const usdt_bal_after = await usdt.balanceOf(user.address);
    expect(usdc_bal_after).to.eq(usdc_bal_before);
    expect(usdt_bal_after).to.gt(usdt_bal_before);
  });

  it('swapTokensForExactTokens', async () => {
    const { user } = await getAccounts();
    const dai_decimals = (await dai.decimals()).toString();
    const usdc_decimals = (await usdc.decimals()).toString();
    const usdt_decimals = (await usdt.decimals()).toString();
    const DAI = new Token(ChainId.MAINNET, DAI_ERC20, parseInt(dai_decimals));
    const USDC = new Token(ChainId.MAINNET, USDC_ERC20, parseInt(usdc_decimals));
    const USDT = new Token(ChainId.MAINNET, USDT_ERC20, parseInt(usdt_decimals));

    const outputAmount = formatERC20Amount(BigNumber.from(20), parseInt(dai_decimals));
    const path = [USDT_ERC20, USDC_ERC20, DAI_ERC20];
    const { amountInMax } = await getArgumentsForSwapTokensForExactTokens(
      [USDT, USDC, DAI],
      outputAmount,
      factory.address,
    );

    const swap_object: SwapType = {
      amount0: outputAmount,
      amount1: amountInMax,
      path: path,
      user: user.address,
      deadline: sinceNow(3600),
    };

    const dai_bal_before = await dai.balanceOf(user.address);
    const usdc_bal_before = await usdc.balanceOf(user.address);
    await router.connect(user).swapTokensForExactTokens(swap_object);
    const dai_bal_after = await dai.balanceOf(user.address);
    const usdc_bal_after = await usdc.balanceOf(user.address);
    expect(dai_bal_after).to.gt(dai_bal_before);
    expect(usdc_bal_after).to.eq(usdc_bal_before);
  });
});
