import { ethers } from 'hardhat';
import chai, { use } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { resetNetwork, getAccounts, loadERC20instance, sinceNow, transferOwnership } from '../../lib/utils';
import { AddLiquidityType, SwapType } from '../../lib/types';
import { solidity } from 'ethereum-waffle';
import { DAI_ERC20 } from '../../lib/constants';
import deployFactory from '../../scripts/deploy/001_factory';
import deployRouter from '../../scripts/deploy/002_router';
import fundERC20ToUser from '../../scripts/local/000_fund';
import { deployCreate2 } from '../../scripts/deploy/000_preflight';
import {
  ConveyorV2Factory,
  ConveyorV2Router01,
  ConveyorV2Pair,
  Deployer,
  DeflatingERC20__factory,
  DeflatingERC20,
} from '../../typechain';
import { ChainId, Token } from '@uniswap/sdk';
import { getArgumentsForSwapExactTokensForTokens, getArgumentsForSwapTokensForExactTokens } from '../../lib/sdk';

use(solidity);
const { expect } = chai;
let factory: ConveyorV2Factory;
let router: ConveyorV2Router01;
let create2: Deployer;
let dai: Contract;
let dfl: DeflatingERC20;

async function loadDeployment() {
  await resetNetwork();
  const { relayer, owner, deployer } = await getAccounts();
  create2 = await deployCreate2();
  factory = await deployFactory(create2);
  router = await deployRouter(create2, factory.address);
  dai = await loadERC20instance(DAI_ERC20);
  await factory.setRouter(router.address);
  await transferOwnership(create2, router.address, owner.address);
  await router.setRelayer(relayer.address, true);
  await router.metaSwitch();

  // deploy deflationary token
  const dflFactory = (await ethers.getContractFactory('DeflatingERC20')) as DeflatingERC20__factory;
  dfl = (await dflFactory.deploy()) as DeflatingERC20;
  await dfl.deployed();
}

describe('ConveyorV2Router01 - fee on transfer', () => {
  before(async () => {
    const { user } = await getAccounts();
    await loadDeployment();
    await fundERC20ToUser(user.address, BigNumber.from(200));

    // approve the router
    const max = '1000000000000000000000000000000';
    await dai.connect(user).approve(router.address, max);
    await dfl.connect(user).approve(router.address, max);
  });

  it('should transfer tokens, balance of recipient is less than transferred amount', async () => {
    const { user, owner } = await getAccounts();
    const expected_amount = ethers.utils.parseEther('200'); // 200 tokens
    await dfl.connect(owner).airdrop(expected_amount);
    await dfl.connect(owner).transfer(user.address, expected_amount);
    const balance = await dfl.balanceOf(user.address);
    expect(balance).to.lt(expected_amount);

    // console.log('dai balance (user): ', (await dai.balanceOf(user.address)).toString());
    // console.log('dfl balance (user): ', (await dfl.balanceOf(user.address)).toString());
  });

  it('should prevent FoT from adding liquidity', async () => {
    const { user } = await getAccounts();
    const amountADesired = ethers.utils.parseEther('50');
    const amountBDesired = ethers.utils.parseEther('50');
    const amountAMin = ethers.utils.parseEther('10');
    const amountBMin = ethers.utils.parseEther('10');
    const deadline = await sinceNow(3600);
    const liquidity_object: AddLiquidityType = {
      tokenA: dai.address,
      tokenB: dfl.address,
      amountADesired: amountADesired,
      amountBDesired: amountBDesired,
      amountAMin: amountAMin,
      amountBMin: amountBMin,
      user: user.address,
      deadline: deadline,
    };

    const tx = router.connect(user).addLiquidity(liquidity_object);
    await expect(tx).to.revertedWith('ConveyorV2Router01: Transfer amount does not match input amount');
  });

  it('should create pair but does not allow minting LP tokens', async () => {
    const { user } = await getAccounts();
    await factory.connect(user).createPair(dai.address, dfl.address);
    const pairAddr = await factory.getPair(dai.address, dfl.address);
    const pair = (await ethers.getContractAt('ConveyorV2Pair', pairAddr)) as ConveyorV2Pair;

    // transfer 50 tokens each to the pair
    const amount = ethers.utils.parseEther('50');
    await dai.connect(user).transfer(pairAddr, amount);
    await dfl.connect(user).transfer(pairAddr, amount);

    // check balances
    const daiBalance = await dai.balanceOf(pairAddr);
    const dflBalance = await dfl.balanceOf(pairAddr);

    expect(daiBalance).to.eq(amount);
    expect(dflBalance).to.lt(amount);

    // cannot mint LP tokens
    const mintTx = pair.connect(user).mint(user.address);
    await expect(mintTx).to.revertedWith('ConveyorV2: FORBIDDEN!');

    // sync reserves to match pair balances
    await pair.sync();

    // check reserves
    const reserves = await pair.getReserves();
    expect(reserves[0]).to.eq(dflBalance);
    expect(reserves[1]).to.eq(daiBalance);
  });

  it('dai -> dfl, swapExactTokensForTokens - reverts for inconsistent output', async () => {
    const { user } = await getAccounts();
    const dai_decimals = (await dai.decimals()).toString();
    const dfl_decimals = (await dfl.decimals()).toString();

    const DAI = new Token(ChainId.MAINNET, DAI_ERC20, parseInt(dai_decimals));
    const DFL = new Token(ChainId.MAINNET, dfl.address, parseInt(dfl_decimals));

    const inputAmount = ethers.utils.parseEther('20'); // 20 DAI
    const path = [DAI_ERC20, dfl.address];

    const { amountOutMin } = await getArgumentsForSwapExactTokensForTokens([DAI, DFL], inputAmount, factory.address);

    const swap_object: SwapType = {
      amount0: inputAmount,
      amount1: amountOutMin,
      path: path,
      user: user.address,
      deadline: sinceNow(3600),
    };

    const tx = router.connect(user).swapExactTokensForTokens(swap_object);
    await expect(tx).to.revertedWith('ConveyorV2Router01: Transfer amount does not match output amount');
  });

  it('dfl -> dai, swapExactTokensForTokens - K Protection', async () => {
    const { user } = await getAccounts();
    const dai_decimals = (await dai.decimals()).toString();
    const dfl_decimals = (await dfl.decimals()).toString();

    const DAI = new Token(ChainId.MAINNET, DAI_ERC20, parseInt(dai_decimals));
    const DFL = new Token(ChainId.MAINNET, dfl.address, parseInt(dfl_decimals));

    const inputAmount = ethers.utils.parseEther('20'); // 20 DFL
    const path = [dfl.address, DAI_ERC20];

    const { amountOutMin } = await getArgumentsForSwapExactTokensForTokens([DFL, DAI], inputAmount, factory.address);

    const swap_object: SwapType = {
      amount0: inputAmount,
      amount1: amountOutMin,
      path: path,
      user: user.address,
      deadline: sinceNow(3600),
    };

    const tx = router.connect(user).swapExactTokensForTokens(swap_object);
    await expect(tx).to.revertedWith('ConveyorV2: K');
  });

  it('dai -> dfl, swapTokensForExactTokens - reverts for inconsistent output', async () => {
    const { user } = await getAccounts();
    const dai_decimals = (await dai.decimals()).toString();
    const dfl_decimals = (await dfl.decimals()).toString();

    const DAI = new Token(ChainId.MAINNET, DAI_ERC20, parseInt(dai_decimals));
    const DFL = new Token(ChainId.MAINNET, dfl.address, parseInt(dfl_decimals));

    const outputAmount = ethers.utils.parseEther('20'); // 20 DAI
    const path = [DAI_ERC20, dfl.address];

    const { amountInMax } = await getArgumentsForSwapTokensForExactTokens([DAI, DFL], outputAmount, factory.address);

    const swap_object: SwapType = {
      amount0: outputAmount,
      amount1: amountInMax,
      path: path,
      user: user.address,
      deadline: sinceNow(3600),
    };

    const tx = router.connect(user).swapTokensForExactTokens(swap_object);
    await expect(tx).to.revertedWith('ConveyorV2Router01: Transfer amount does not match output amount');
  });

  it('dfl -> dai, swapTokensForExactTokens - K Protection', async () => {
    const { user } = await getAccounts();
    const dai_decimals = (await dai.decimals()).toString();
    const dfl_decimals = (await dfl.decimals()).toString();

    const DAI = new Token(ChainId.MAINNET, DAI_ERC20, parseInt(dai_decimals));
    const DFL = new Token(ChainId.MAINNET, dfl.address, parseInt(dfl_decimals));

    const outputAmount = ethers.utils.parseEther('20'); // 20 DFL
    const path = [dfl.address, DAI_ERC20];

    const { amountInMax } = await getArgumentsForSwapTokensForExactTokens([DFL, DAI], outputAmount, factory.address);

    const swap_object: SwapType = {
      amount0: outputAmount,
      amount1: amountInMax,
      path: path,
      user: user.address,
      deadline: sinceNow(3600),
    };

    const tx = router.connect(user).swapTokensForExactTokens(swap_object);
    await expect(tx).to.revertedWith('ConveyorV2: K');
  });
});
