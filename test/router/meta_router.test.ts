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
import { AddLiquidityType, SwapType, PermitType, RemoveLiquidityType, MetaTxType } from '../../lib/types';
import { solidity } from 'ethereum-waffle';
import { DAI_ERC20, USDT_ERC20, USDC_ERC20 } from '../../lib/constants';
import deployFactory from '../../scripts/deploy/001_factory';
import deployRouter from '../../scripts/deploy/002_router';
import fundERC20ToUser from '../../scripts/local/000_fund';
import addLiquidity from '../../scripts/local/001_addLiquidity';
import {
  ConveyorV2Factory,
  ConveyorV2Router01,
  ConveyorV2Pair,
  ReentrantToken__factory,
  ReentrantToken,
  Deployer,
} from '../../typechain';
import * as eip712 from '../../lib/eip712';
import { ChainId, Token } from '@uniswap/sdk';
import { getArgumentsForSwapExactTokensForTokens } from '../../lib/sdk';
import {
  encodeAddLiquidity,
  encodeSwapExactTokensForTokens,
  encodeRemoveLiquidityWithPermit,
} from '../../lib/functionSig';
import { pair } from '../../lib/pair';
import { deployCreate2 } from '../../scripts/deploy/000_preflight';

use(solidity);
const { expect } = chai;
const zero = '0x' + '0'.repeat(64);
let factory: ConveyorV2Factory;
let router: ConveyorV2Router01;
let create2: Deployer;
let dai: Contract;
let usdt: Contract;
let usdc: Contract;
let replaySig: Signature;
const gasLimit = BigNumber.from(410000);
const gasPrice = BigNumber.from(10000000000);
const fee = gasLimit.mul(gasPrice);
const tokenPricePerEth = BigNumber.from(2822000000);
const maxTokenFee = tokenPricePerEth.mul(fee).div(BigNumber.from(10).pow(18));

async function loadDeployment() {
  const { relayer, user, owner } = await getAccounts();
  await resetNetwork();
  create2 = await deployCreate2();
  factory = await deployFactory(create2);
  router = await deployRouter(create2, factory.address);
  dai = await loadERC20instance(DAI_ERC20);
  usdt = await loadERC20instance(USDT_ERC20);
  usdc = await loadERC20instance(USDC_ERC20);
  await factory.setRouter(router.address);
  await transferOwnership(create2, router.address, owner.address);
  await router.setRelayer(relayer.address, true);
  await router.setFeeHolder(relayer.address);
  await fundERC20ToUser(user.address, BigNumber.from(10000));
}

describe('ConveyorV2Router01 - Meta TX', async () => {
  before(async () => {
    await loadDeployment();
  });

  it('should revert adding liquidity from an unauthorized relayer', async () => {
    const expected_error = 'Error: Meta enabled!';
    try {
      await addLiquidity(router, DAI_ERC20, USDT_ERC20, BigNumber.from(10), BigNumber.from(100), 3600);
    } catch (e) {
      const error = e as Error;
      expect(error.message).to.equal(expected_error);
    }
  });

  it('should add liquidity with meta-tx', async () => {
    // local scope
    const gasLimit = BigNumber.from(4700000);
    const gasPrice = BigNumber.from(10000000000);
    const fee = gasLimit.mul(gasPrice);
    const tokenPricePerEth = BigNumber.from(2822000000);
    const maxTokenFee = tokenPricePerEth.mul(fee).div(BigNumber.from(10).pow(18));

    // define type
    const { relayer, user } = await getAccounts();
    const minAmount = BigNumber.from(200);
    const desiredAmount = BigNumber.from(500);
    const min_dai = formatERC20Amount(minAmount, await dai.decimals());
    const min_usdt = formatERC20Amount(minAmount, await usdt.decimals());
    const desired_dai = formatERC20Amount(desiredAmount, await dai.decimals());
    const desired_usdt = formatERC20Amount(desiredAmount, await usdt.decimals());
    const liquidity_object: AddLiquidityType = {
      tokenA: DAI_ERC20,
      tokenB: USDT_ERC20,
      amountADesired: desired_dai,
      amountBDesired: desired_usdt,
      amountAMin: min_dai,
      amountBMin: min_usdt,
      user: user.address,
      deadline: sinceNow(3600),
    };
    const domainName = 'ConveyorV2-AddLiquidity';

    // generate payload
    const payload = eip712.hashAddLiquidityPayload(liquidity_object);

    const userNonce = await router.nonces(user.address);

    // meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDT_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeAddLiquidity(liquidity_object),
      hashedPayload: payload,
    };

    // generate eip712
    const message = await eip712.getForwarderMessage(meta);
    const domain = eip712.getDomain(router.address, 1, domainName);
    const sig = await eip712.signEIP712(user, domain, eip712.EIP712ForwarderType, message);
    replaySig = sig;

    // set allowance
    const max = '1000000000000000000000000000000';
    await dai.connect(user).approve(router.address, BigNumber.from(max));
    await usdt.connect(user).approve(router.address, BigNumber.from(max));

    // estimate gas
    // const estimate = await router.connect(relayer).estimateGas.executeMetaTx(meta, domainName, sig);
    // console.log('estimated gas usage: ', estimate.toString());
    // console.log('gas price: ', gasPrice.toString());
    // const expected_fee = estimate.mul(gasPrice);

    // execute meta-tx
    const usdt_before = await usdt.balanceOf(relayer.address);
    const eth_before = await ethers.provider.getBalance(relayer.address);
    expect(usdt_before).to.eq(0);
    const tx = await router
      .connect(relayer)
      .executeMetaTx(meta, domainName, tokenPricePerEth, liquidity_object.amountBDesired, sig, {
        gasLimit: gasLimit,
        gasPrice: gasPrice,
      });
    const receipt = await tx.wait();
    console.log('meta gas used (adding liquidity): ', receipt.gasUsed.toString());
    const usdt_after = await usdt.balanceOf(relayer.address);
    const eth_after = await ethers.provider.getBalance(relayer.address);
    const diff = usdt_after.sub(usdt_before);
    const eth_diff = eth_before.sub(eth_after);
    expect(diff).to.lte(maxTokenFee);
    expect(diff).to.gt(0);
    // console.log('dai compensated: ', diff.toString());
    // // console.log('expected fee: ', expected_fee.toString());
    // console.log('actual fee: ', eth_diff.toString());

    // const percent = diff.mul(100).div(eth_diff);
    // console.log(`Compensation Percentage: ${percent.toString()} %`);
    // const delta = diff.sub(eth_diff).div(gasPrice);
    // console.log('delta: ', delta.toString());

    // check liquidity
    const pairAddress = await factory.getPair(USDT_ERC20, DAI_ERC20);
    const LP = (await ethers.getContractAt('ConveyorV2Pair', pairAddress)) as ConveyorV2Pair;
    expect(await LP.balanceOf(user.address)).to.gt(0);
    expect(await dai.balanceOf(pairAddress)).to.eq(desired_dai);
    expect(await usdt.balanceOf(pairAddress)).to.eq(desired_usdt);
  });

  it('should catch a replay attack', async () => {
    // define type
    const { relayer, user } = await getAccounts();
    const minAmount = BigNumber.from(200);
    const desiredAmount = BigNumber.from(500);
    const min_dai = formatERC20Amount(minAmount, await dai.decimals());
    const min_usdt = formatERC20Amount(minAmount, await usdt.decimals());
    const desired_dai = formatERC20Amount(desiredAmount, await dai.decimals());
    const desired_usdt = formatERC20Amount(desiredAmount, await usdt.decimals());
    const liquidity_object: AddLiquidityType = {
      tokenA: DAI_ERC20,
      tokenB: USDT_ERC20,
      amountADesired: desired_dai,
      amountBDesired: desired_usdt,
      amountAMin: min_dai,
      amountBMin: min_usdt,
      user: user.address,
      deadline: sinceNow(3600),
    };
    const domainName = 'ConveyorV2-AddLiquidity';

    // generate payload
    const payload = eip712.hashAddLiquidityPayload(liquidity_object);

    const userNonce = await router.nonces(user.address);

    // meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDT_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeAddLiquidity(liquidity_object),
      hashedPayload: payload,
    };

    // execute meta-tx
    await expect(
      router
        .connect(relayer)
        .executeMetaTx(meta, domainName, tokenPricePerEth, liquidity_object.amountBDesired, replaySig, {
          gasLimit: gasLimit,
          gasPrice: gasPrice,
        }),
    ).to.revertedWith('ERC20ForwarderError: Invalid signature');
  });

  it('should prevent an attacker to add liquidity on the behalf of the user', async () => {
    // local scope
    const gasLimit = BigNumber.from(4700000);
    const gasPrice = BigNumber.from(10000000000);
    const fee = gasLimit.mul(gasPrice);
    const tokenPricePerEth = BigNumber.from(2822000000);
    const maxTokenFee = tokenPricePerEth.mul(fee).div(BigNumber.from(10).pow(18));

    // define type
    const { relayer, user } = await getAccounts();
    const attacker = (await ethers.getSigners())[4];
    const minAmount = BigNumber.from(200);
    const desiredAmount = BigNumber.from(500);
    const min_dai = formatERC20Amount(minAmount, await dai.decimals());
    const min_usdt = formatERC20Amount(minAmount, await usdt.decimals());
    const desired_dai = formatERC20Amount(desiredAmount, await dai.decimals());
    const desired_usdt = formatERC20Amount(desiredAmount, await usdt.decimals());
    const liquidity_object: AddLiquidityType = {
      tokenA: DAI_ERC20,
      tokenB: USDT_ERC20,
      amountADesired: desired_dai,
      amountBDesired: desired_usdt,
      amountAMin: min_dai,
      amountBMin: min_usdt,
      user: user.address,
      deadline: sinceNow(3600),
    };
    const domainName = 'ConveyorV2-AddLiquidity';

    // generate payload
    const payload = eip712.hashAddLiquidityPayload(liquidity_object);

    const userNonce = await router.nonces(attacker.address);

    // meta-tx
    const meta: MetaTxType = {
      from: attacker.address,
      feeToken: USDT_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeAddLiquidity(liquidity_object),
      hashedPayload: payload,
    };

    // generate eip712
    const message = await eip712.getForwarderMessage(meta);
    const domain = eip712.getDomain(router.address, 1, domainName);
    const sig = await eip712.signEIP712(attacker, domain, eip712.EIP712ForwarderType, message);
    replaySig = sig;

    // set allowance
    await fundERC20ToUser(attacker.address, BigNumber.from(1000));
    const max = '1000000000000000000000000000000';
    await dai.connect(attacker).approve(router.address, BigNumber.from(max));
    await usdt.connect(attacker).approve(router.address, BigNumber.from(max));

    // estimate gas
    // const estimate = await router.connect(relayer).estimateGas.executeMetaTx(meta, domainName, sig);
    // console.log('estimated gas usage: ', estimate.toString());
    // console.log('gas price: ', gasPrice.toString());
    // const expected_fee = estimate.mul(gasPrice);

    // execute meta-tx
    const tx = await router
      .connect(relayer)
      .executeMetaTx(meta, domainName, tokenPricePerEth, liquidity_object.amountBDesired, sig, {
        gasLimit: gasLimit,
        gasPrice: gasPrice,
      });
    expect(tx)
      .to.emit(router, 'MetaStatus')
      .withArgs(attacker.address, false, 'ConveyorV2Router: Sender does not match token recipient');
  });

  // this test involves adding a pair of a malicious token (i.e. Reentrant (REE) token) and a normal ERC20 token
  // for this test case, the attacker attempts to add a pair of REE-DAI tokens to the router
  // The REE token performs a reentrancy attack on the router and attempts to call a swap function to trade DAI for USDT.
  it('should prevent a reentrency attack (delegatecall to a swap via a bad token)', async () => {
    // local scope
    const gasLimit = BigNumber.from(4700000);
    const gasPrice = BigNumber.from(10000000000);
    const fee = gasLimit.mul(gasPrice);
    const tokenPricePerEth = BigNumber.from(2822000000);
    const maxTokenFee = tokenPricePerEth.mul(fee).div(BigNumber.from(10).pow(18));

    const { relayer, user } = await getAccounts();
    const attacker = user.address;
    const stable_pair = await factory.getPair(USDT_ERC20, DAI_ERC20);

    // deploy REE
    const ree_factory = (await ethers.getContractFactory('ReentrantToken')) as ReentrantToken__factory;
    const ree = (await ree_factory.deploy(router.address, stable_pair, USDT_ERC20, DAI_ERC20)) as ReentrantToken;
    await ree.deployed();
    const REE_ERC20 = ree.address;
    const ree_amount = formatERC20Amount(BigNumber.from(1000), await ree.decimals());

    // mint REE to the attacker
    await ree.connect(user).airdrop(ree_amount);
    expect(await ree.balanceOf(attacker)).to.eq(ree_amount);

    // Send 50 DAI to the REE contract
    await dai.connect(user).transfer(REE_ERC20, formatERC20Amount(BigNumber.from(50), await dai.decimals()));

    // define add liquidity struct
    const minAmount = BigNumber.from(20);
    const desiredAmount = BigNumber.from(50);
    const min_dai = formatERC20Amount(minAmount, await dai.decimals());
    const min_ree = formatERC20Amount(minAmount, await ree.decimals());
    const desired_dai = formatERC20Amount(desiredAmount, await dai.decimals());
    const desired_ree = formatERC20Amount(desiredAmount, await ree.decimals());
    const liquidity_object: AddLiquidityType = {
      tokenA: DAI_ERC20,
      tokenB: REE_ERC20,
      amountADesired: desired_dai,
      amountBDesired: desired_ree,
      amountAMin: min_dai,
      amountBMin: min_ree,
      user: attacker,
      deadline: sinceNow(3600),
    };

    // generate payload
    const payload = eip712.hashAddLiquidityPayload(liquidity_object);
    const userNonce = await router.nonces(attacker);

    // approve tokens
    const max = '1000000000000000000000000000000';
    await ree.connect(user).approve(router.address, max);
    await usdc.connect(user).approve(router.address, max); // to pay fees

    // meta-tx
    const meta: MetaTxType = {
      from: attacker,
      feeToken: USDC_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: liquidity_object.deadline,
      nonce: userNonce,
      data: encodeAddLiquidity(liquidity_object),
      hashedPayload: payload,
    };

    // EIP 712 signature
    const domainName = 'ConveyorV2';
    const domain = eip712.getDomain(router.address, 1, domainName);
    const message = eip712.getForwarderMessage(meta);
    const sig = await eip712.signEIP712(user, domain, eip712.EIP712ForwarderType, message);

    const usdt_before = await usdt.balanceOf(REE_ERC20);

    // execute the meta-tx
    const tx = await router.connect(relayer).executeMetaTx(meta, domainName, tokenPricePerEth, 0, sig, {
      gasLimit: gasLimit,
      gasPrice: gasPrice,
    });

    await expect(tx).to.emit(ree, 'AttackStatus').withArgs(attacker, false, 'ConveyorV2Router: FORBIDDEN! Meta only');

    // the pair still exists, but the swap should not happen. we need to verify if the attacker has managed to swap DAI for USDT.
    await expect(tx).to.emit(router, 'MetaStatus').withArgs(attacker, true, '');

    // verify pair
    const ree_pair = await factory.getPair(REE_ERC20, DAI_ERC20);
    const computed_ree_pair = await pair(REE_ERC20, DAI_ERC20, factory.address);
    expect(ree_pair.toLowerCase()).to.eq(computed_ree_pair);

    const usdt_after = await usdt.balanceOf(REE_ERC20);
    expect(usdt_after).to.eq(usdt_before);
  });

  it('should swapExactTokensForTokens - meta', async () => {
    const { user, relayer } = await getAccounts();
    // await addLiquidity(router, ATA_ERC20, DAI_ERC20, BigNumber.from(100), BigNumber.from(200), 3600);
    const max = '1000000000000000000000000000000';
    const dai_decimals = (await dai.decimals()).toString();
    const usdt_decimals = (await usdt.decimals()).toString();
    const DAI = new Token(ChainId.MAINNET, DAI_ERC20, parseInt(dai_decimals));
    const USDT = new Token(ChainId.MAINNET, USDT_ERC20, parseInt(usdt_decimals));
    const domainName = 'ConveyorV2-Swap';

    const inputAmount = formatERC20Amount(BigNumber.from(20), parseInt(usdt_decimals));
    const path = [USDT_ERC20, DAI_ERC20];
    const { amountOutMin } = await getArgumentsForSwapExactTokensForTokens([USDT, DAI], inputAmount, factory.address);

    const swap_object: SwapType = {
      amount0: inputAmount,
      amount1: amountOutMin,
      path: path,
      user: user.address,
      deadline: sinceNow(3600),
    };

    // generate payload
    const payload = eip712.hashSwapPayload(swap_object);

    const userNonce = await router.nonces(user.address);

    // define meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDT_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeSwapExactTokensForTokens(swap_object),
      hashedPayload: payload,
    };

    // sign eip712
    const domain = eip712.getDomain(router.address, 1, domainName);
    const message = eip712.getForwarderMessage(meta);
    const sig = await eip712.signEIP712(user, domain, eip712.EIP712ForwarderType, message);

    const dai_bal_before = await dai.balanceOf(user.address);
    const usdt_before = await usdt.balanceOf(relayer.address);
    const eth_before = await ethers.provider.getBalance(relayer.address);
    // const estimate = await router.connect(relayer).estimateGas.executeMetaTx(meta, domainName, sig);
    // const gasPrice = BigNumber.from(10).pow(10);
    // const expected_fee = estimate.mul(gasPrice);
    const tx = await router
      .connect(relayer)
      .executeMetaTx(meta, domainName, tokenPricePerEth, swap_object.amount0, sig, {
        gasPrice: gasPrice,
        gasLimit: gasLimit,
      });
    const receipt = await tx.wait();
    console.log('meta gas used (swapExactTokensForTokens): ', receipt.gasUsed.toString());
    const usdt_after = await usdt.balanceOf(relayer.address);
    const dai_bal_after = await dai.balanceOf(user.address);
    const eth_after = await ethers.provider.getBalance(relayer.address);
    const usdt_diff = usdt_after.sub(usdt_before);
    const eth_diff = eth_before.sub(eth_after);

    expect(usdt_diff).to.lte(maxTokenFee);
    expect(usdt_diff).to.gt(0);
    expect(dai_bal_after).to.gt(dai_bal_before);

    console.log('usdt compensated: ', usdt_diff.toString());
    console.log('actual fee: ', eth_diff.toString());

    // const percent = dai_diff.mul(100).div(eth_diff);
    // console.log(`Compensation Percentage: ${percent.toString()} %`);
    // const delta = dai_diff.sub(eth_diff).div(gasPrice);
    // console.log('delta: ', delta.toString());
  });

  it('should remove liquidity - meta', async () => {
    // local scope
    const gasLimit = BigNumber.from(4700000);
    const gasPrice = BigNumber.from(10000000000);
    const fee = gasLimit.mul(gasPrice);
    const tokenPricePerEth = BigNumber.from(2822000000);
    const maxTokenFee = tokenPricePerEth.mul(fee).div(BigNumber.from(10).pow(18));

    const { user, relayer } = await getAccounts();
    const pairAddress = await factory.getPair(USDT_ERC20, DAI_ERC20);
    const LP = (await ethers.getContractAt('ConveyorV2Pair', pairAddress)) as ConveyorV2Pair;
    const liquidity = await LP.balanceOf(user.address);
    const minAmount = BigNumber.from(200);
    const min_dai = formatERC20Amount(minAmount, await dai.decimals());
    const min_usdt = formatERC20Amount(minAmount, await usdt.decimals());
    const permit_struct: PermitType = {
      owner: user.address,
      spender: router.address,
      value: liquidity,
      deadline: sinceNow(3600),
    };
    const removeLiquidity_struct: RemoveLiquidityType = {
      tokenA: DAI_ERC20,
      tokenB: USDT_ERC20,
      liquidity: liquidity,
      amountAMin: min_dai,
      amountBMin: min_usdt,
      user: user.address,
      deadline: sinceNow(3600),
    };

    // sign permit
    const permitNonce = await LP.nonces(user.address);
    const permitDomain = eip712.getDomain(pairAddress, 1, 'Conveyor V2');
    const permitMessage = eip712.getPermitMessage(permit_struct, permitNonce);
    const permitSig = await eip712.signEIP712(user, permitDomain, eip712.EIP712PermitType, permitMessage);

    // payload
    const removeLiquidity_payload = eip712.hashRemoveLiquidityPayload(removeLiquidity_struct, permitSig);

    const userNonce = await router.nonces(user.address);

    // define meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDT_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeRemoveLiquidityWithPermit(removeLiquidity_struct, permitSig),
      hashedPayload: removeLiquidity_payload,
    };

    // sign forwarder
    const domainName = 'ConveyorV2-RemoveLiquidity';
    const domain = eip712.getDomain(router.address, 1, domainName);
    const message = eip712.getForwarderMessage(meta);
    const sig = await eip712.signEIP712(user, domain, eip712.EIP712ForwarderType, message);

    const usdt_before = await usdt.balanceOf(relayer.address);
    const dai_pair_before = await dai.balanceOf(pairAddress);
    const usdt_pair_before = await usdt.balanceOf(pairAddress);
    const lp_before = await LP.balanceOf(user.address);
    const eth_before = await ethers.provider.getBalance(relayer.address);
    // const estimate = await router.connect(relayer).estimateGas.executeMetaTx(meta, domainName, sig);
    // const gasPrice = BigNumber.from(10).pow(10);
    // const expected_fee = estimate.mul(gasPrice);
    const tx = await router
      .connect(relayer)
      .executeMetaTx(meta, domainName, tokenPricePerEth, 0, sig, { gasPrice: gasPrice, gasLimit: gasLimit });
    const receipt = await tx.wait();
    console.log('meta gas used (removeLiquidity): ', receipt.gasUsed.toString());
    const usdt_after = await usdt.balanceOf(relayer.address);
    const eth_after = await ethers.provider.getBalance(relayer.address);
    const usdt_diff = usdt_after.sub(usdt_before);
    const eth_diff = eth_before.sub(eth_after);

    const dai_pair_after = await dai.balanceOf(pairAddress);
    const usdt_pair_after = await usdt.balanceOf(pairAddress);
    const lp_after = await LP.balanceOf(user.address);
    expect(dai_pair_after).to.lt(dai_pair_before);
    expect(usdt_pair_after).to.lt(usdt_pair_before);
    expect(lp_after).to.lt(lp_before);

    expect(usdt_diff).to.lte(maxTokenFee);
    expect(usdt_diff).to.gt(0);

    // console.log('usdt compensated: ', usdt_diff.toString());
    // console.log('actual fee: ', eth_diff.toString());

    // const percent = usdt_diff.mul(100).div(eth_diff);
    // console.log(`Compensation Percentage: ${percent.toString()} %`);
    // const delta = usdt_diff.sub(eth_diff).div(gasPrice);
    // console.log('delta: ', delta.toString());
  });
});
