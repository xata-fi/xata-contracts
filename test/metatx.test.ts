import { ethers } from 'hardhat';
import { utils } from 'ethers';
const { keccak256, defaultAbiCoder, toUtf8Bytes, solidityPack, isBytesLike } = utils;
import chai, { use } from 'chai';
import { BigNumber, Contract, Signature } from 'ethers';
import { resetNetwork, getAccounts, sinceNow, loadERC20instance, formatERC20Amount } from '../lib/utils';
import { solidity } from 'ethereum-waffle';
import { Greeter, Greeter__factory } from '../typechain';
import { encodeExecuteMetaTx, encodeSetGreeter } from '../lib/functionSig';
import { USDC_ERC20 } from '../lib/constants';
import fundERC20ToUser from '../scripts/local/000_fund';
import * as eip712 from '../lib/eip712';
import { MetaTxType } from '../lib/types';

use(solidity);
const { expect } = chai;
const zeroBytes = '0x' + '0'.repeat(64);
const zeroSigs: Signature = { v: 27, r: zeroBytes, s: zeroBytes, recoveryParam: 0, _vs: zeroBytes };
let replaySig: Signature;
let greeter: Greeter;
let usdc: Contract;
const gasLimit = BigNumber.from(300000);
const gasPrice = BigNumber.from(10000000000);
const fee = gasLimit.mul(gasPrice);
const tokenPricePerEth = BigNumber.from(2822000000);
const maxTokenFee = tokenPricePerEth.mul(fee).div(BigNumber.from(10).pow(18));

async function loadGreeter(): Promise<void> {
  const { relayer } = await getAccounts();
  const Greeter = (await ethers.getContractFactory('Greeter')) as Greeter__factory;
  greeter = (await Greeter.deploy('Hello, World!', relayer.address)) as Greeter;
  await greeter.deployed();
  await greeter.setFeeHolder(relayer.address);
}

describe('Meta-Tx', () => {
  const message = 'Hello, Meta!';

  before(async () => {
    await resetNetwork();
    await loadGreeter();
    usdc = await loadERC20instance(USDC_ERC20);
  });

  it('should catch unauthorized relayer', async () => {
    const errorMsg = 'ERC20ForwarderError: Unauthorized Caller!';
    const { relayer, user } = await getAccounts();
    const max = '1000000000000000000000000000000';

    // meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDC_ERC20,
      maxTokenAmount: BigNumber.from(max),
      deadline: sinceNow(3600),
      nonce: BigNumber.from(0),
      data: encodeSetGreeter(message),
      hashedPayload: zeroBytes,
    };

    await expect(greeter.executeMetaTx(meta, 'Greeter', gasPrice, 0, zeroSigs)).to.revertedWith(errorMsg);

    const usdc_bal = await usdc.balanceOf(relayer.address);
    expect(usdc_bal).to.eq(0);
  });

  it('should revert insufficient balance - no relayer compensation', async () => {
    const { relayer, user } = await getAccounts();
    const max = '1000000000000000000000000000000';

    // meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDC_ERC20,
      maxTokenAmount: BigNumber.from(max),
      deadline: sinceNow(3600),
      nonce: BigNumber.from(0),
      data: encodeSetGreeter(message),
      hashedPayload: zeroBytes,
    };

    await expect(greeter.connect(relayer).executeMetaTx(meta, 'Greeter', gasPrice, 0, zeroSigs)).to.revertedWith(
      'ERC20ForwarderError: Insufficient balance',
    );

    const usdc_bal = await usdc.balanceOf(relayer.address);
    expect(usdc_bal).to.eq(0);
  });

  it('should revert insufficient maxTokenAmount - no relayer compensation', async () => {
    const { relayer, user } = await getAccounts();
    await fundERC20ToUser(user.address, BigNumber.from(10000));

    // meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDC_ERC20,
      maxTokenAmount: BigNumber.from(0),
      deadline: sinceNow(3600),
      nonce: BigNumber.from(0),
      data: encodeSetGreeter(message),
      hashedPayload: zeroBytes,
    };

    await expect(
      greeter.connect(relayer).executeMetaTx(meta, 'Greeter', tokenPricePerEth, 0, zeroSigs),
    ).to.revertedWith('ERC20ForwarderError: Insufficient maxTokenAmount');

    const usdc_bal = await usdc.balanceOf(relayer.address);
    expect(usdc_bal).to.eq(0);
  });

  it('should revert from a CALL on the metatx function sig', async () => {
    const { relayer, user } = await getAccounts();
    await usdc.connect(user).approve(greeter.address, formatERC20Amount(BigNumber.from(1000)));

    const price = await ethers.provider.getGasPrice();
    const maxFee = tokenPricePerEth.div(BigNumber.from(10).pow(18)).mul(price).mul(gasLimit);

    const userNonce = await greeter.nonces(user.address);

    // meta-tx
    const fake_meta: MetaTxType = {
      from: user.address,
      feeToken: USDC_ERC20,
      maxTokenAmount: maxFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeSetGreeter(message),
      hashedPayload: zeroBytes,
    };

    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDC_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeExecuteMetaTx(fake_meta, 'Greeter', tokenPricePerEth, BigNumber.from(0), zeroSigs),
      hashedPayload: zeroBytes,
    };

    const domainName = 'Greeter';
    const domain = eip712.getDomain(greeter.address, 1, domainName);
    expect(await greeter.nonces(meta.from)).to.eq(0);
    const forwarderMessage = eip712.getForwarderMessage(meta);
    const signature = await eip712.signEIP712(user, domain, eip712.EIP712ForwarderType, forwarderMessage);

    await expect(
      greeter
        .connect(relayer)
        .executeMetaTx(meta, 'Greeter', tokenPricePerEth, 0, signature, { gasLimit: gasLimit, gasPrice: price }),
    )
      .to.emit(greeter, 'MetaStatus')
      .withArgs(meta.from, false, 'ERC20ForwarderFailure: Invalid function signature');

    const usdc_bal = await usdc.balanceOf(relayer.address);
    expect(usdc_bal).to.lte(maxTokenFee);
  });

  it('should set greeter - meta tx', async () => {
    const { relayer, user } = await getAccounts();
    const from = user.address;
    const to = (await ethers.getSigners())[3].address;
    const message = 'Hello, Meta!';

    // eip 712

    // domain
    const domainName = 'Greeter';
    const domain = eip712.getDomain(greeter.address, 1, domainName);

    // payload
    const PAYLOAD_TYPEHASH = keccak256(toUtf8Bytes('Payload(address from,address to,string message)'));
    const hashedPayload = keccak256(
      defaultAbiCoder.encode(
        ['bytes32', 'address', 'address', 'bytes32'],
        [PAYLOAD_TYPEHASH, from, to, keccak256(toUtf8Bytes(message))],
      ),
    );

    const userNonce = await greeter.nonces(user.address);

    // meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDC_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeSetGreeter(message),
      hashedPayload: hashedPayload,
    };

    // sign the message
    expect(await greeter.nonces(meta.from)).to.eq(1);
    const forwarderMessage = eip712.getForwarderMessage(meta);
    const signature = await eip712.signEIP712(user, domain, eip712.EIP712ForwarderType, forwarderMessage);
    replaySig = signature;

    const usdc_before = await usdc.balanceOf(relayer.address);

    // // execute the meta-tx
    const tx = await greeter
      .connect(relayer)
      .executeMetaTx(meta, domainName, tokenPricePerEth, 0, signature, { gasLimit: gasLimit, gasPrice: gasPrice });
    expect(tx).to.emit(greeter, 'MetaStatus').withArgs(meta.from, true, '');

    const usdc_after = await usdc.balanceOf(relayer.address);
    const diff = usdc_after.sub(usdc_before);
    expect(diff).to.lte(maxTokenFee);
    // console.log('usdc max: ', maxTokenFee.toString());
    // console.log('usdc actual: ', diff.toString());

    // const receipt = await tx.wait();
    // const gasUsed = receipt.gasUsed;
    // console.log('gas used: ', gasUsed.toString());

    expect(await greeter.greet()).to.eq(message);
  });

  it('should prevent a replay attack - no relayer compensation', async () => {
    const { relayer, user } = await getAccounts();
    const message = 'Hello, Meta!';
    const from = user.address;
    const to = (await ethers.getSigners())[3].address;
    const domainName = 'Greeter';

    // payload
    const PAYLOAD_TYPEHASH = keccak256(toUtf8Bytes('Payload(address from,address to,string message)'));
    const hashedPayload = keccak256(
      defaultAbiCoder.encode(
        ['bytes32', 'address', 'address', 'bytes32'],
        [PAYLOAD_TYPEHASH, from, to, keccak256(toUtf8Bytes(message))],
      ),
    );

    const userNonce = await greeter.nonces(user.address);

    // meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDC_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeSetGreeter(message),
      hashedPayload: hashedPayload,
    };

    await expect(
      greeter
        .connect(relayer)
        .executeMetaTx(meta, domainName, tokenPricePerEth, 0, replaySig, { gasLimit: gasLimit, gasPrice: gasPrice }),
    ).to.revertedWith('ERC20ForwarderError: Invalid signature');
    expect(await greeter.nonces(meta.from)).to.eq(2);
  });

  it('should not round down to zero fee due to insignificantly low token price', async () => {
    // local scope
    const gasLimit = BigNumber.from(300000);
    const gasPrice = BigNumber.from(10000000000);
    const fee = gasLimit.mul(gasPrice);
    const tokenPricePerEth = BigNumber.from(2000000);
    const maxTokenFee = tokenPricePerEth.mul(fee).div(BigNumber.from(10).pow(18));

    const { relayer, user } = await getAccounts();
    const from = user.address;
    const to = (await ethers.getSigners())[3].address;
    const message = 'Hello, Cheaper Meta!';

    // eip 712

    // domain
    const domainName = 'Greeter';
    const domain = eip712.getDomain(greeter.address, 1, domainName);

    // payload
    const PAYLOAD_TYPEHASH = keccak256(toUtf8Bytes('Payload(address from,address to,string message)'));
    const hashedPayload = keccak256(
      defaultAbiCoder.encode(
        ['bytes32', 'address', 'address', 'bytes32'],
        [PAYLOAD_TYPEHASH, from, to, keccak256(toUtf8Bytes(message))],
      ),
    );

    const userNonce = await greeter.nonces(user.address);

    // meta-tx
    const meta: MetaTxType = {
      from: user.address,
      feeToken: USDC_ERC20,
      maxTokenAmount: maxTokenFee,
      deadline: sinceNow(3600),
      nonce: userNonce,
      data: encodeSetGreeter(message),
      hashedPayload: hashedPayload,
    };

    // sign the message
    expect(await greeter.nonces(meta.from)).to.eq(2);
    const forwarderMessage = eip712.getForwarderMessage(meta);
    const signature = await eip712.signEIP712(user, domain, eip712.EIP712ForwarderType, forwarderMessage);
    replaySig = signature;

    const usdc_before = await usdc.balanceOf(relayer.address);

    // // execute the meta-tx
    const tx = await greeter
      .connect(relayer)
      .executeMetaTx(meta, domainName, tokenPricePerEth, 0, signature, { gasLimit: gasLimit, gasPrice: gasPrice });
    expect(tx).to.emit(greeter, 'MetaStatus').withArgs(meta.from, true, '');

    // const receipt = await tx.wait();
    // const actualGas = receipt.gasUsed;
    // const actualFee = actualGas.mul(gasPrice);
    // const maxUsedTokenFee = (actualFee.mul(tokenPricePerEth)).div(BigNumber.from(10).pow(18));

    const usdc_after = await usdc.balanceOf(relayer.address);
    const diff = usdc_after.sub(usdc_before);
    expect(diff).to.lte(maxTokenFee);
    expect(diff).to.gt(0);
    // console.log('usdc max: ', maxTokenFee.toString());
    // console.log('usdc actual: ', diff.toString());

    // const receipt = await tx.wait();
    // const gasUsed = receipt.gasUsed;
    // console.log('gas used: ', gasUsed.toString());

    expect(await greeter.greet()).to.eq(message);
  });
});
