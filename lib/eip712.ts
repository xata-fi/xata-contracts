import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, BytesLike, Signature, utils } from 'ethers';
import { AddLiquidityType, SwapType, PermitType, MetaTxType, RemoveLiquidityType } from './types';
const { keccak256, defaultAbiCoder, toUtf8Bytes, solidityPack, splitSignature, arrayify } = utils;

interface TypedDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

interface TypedPermit {
  owner: string;
  spender: string;
  value: BigNumber;
  nonce: BigNumber;
  deadline: BigNumber;
}

interface TypedForwarder {
  from: string;
  feeToken: string;
  maxTokenAmount: BigNumber;
  deadline: BigNumber;
  nonce: BigNumber;
  data: string;
  hashedPayload: string;
}

export function getDomain(contractAddress: string, chain_id: number, domain_name: string): TypedDomain {
  return {
    name: domain_name,
    version: '1',
    chainId: chain_id,
    verifyingContract: contractAddress,
  };
}

// const AddLiquidityForwarderType = {
//   AddLiquidity: [
//     { name: 'tokenA', type: 'address' },
//     { name: 'tokenB', type: 'address' },
//     { name: 'amountADesired', type: 'uint256' },
//     { name: 'amountBDesired', type: 'uint256' },
//     { name: 'amountAMin', type: 'uint256' },
//     { name: 'amountBMin', type: 'uint256' },
//     { name: 'user', type: 'address' },
//     { name: 'deadline', type: 'uint256' },
//   ],
// Forwarder: [
//   { name: 'from', type: 'address' },
//   { name: 'feeToken', type: 'address' },
//   { name: 'maxTokenAmount', type: 'uint256' },
//   { name: 'deadline', type: 'uint256' },
//   { name: 'nonce', type: 'uint256' },
//   { name: 'data', type: 'bytes' },
//   { name: 'hashedPayload', type: 'AddLiquidity' },
// ],
// };

// const SwapForwarderType = {
//   Swap: [
//     { name: 'amount0', type: 'uint256' },
//     { name: 'amount1', type: 'uint256' },
//     { name: 'path', type: 'address[]' },
//     { name: 'user', type: 'address' },
//     { name: 'deadline', type: 'uint256' },
//   ],
// Forwarder: [
//   { name: 'from', type: 'address' },
//   { name: 'feeToken', type: 'address' },
//   { name: 'maxTokenAmount', type: 'uint256' },
//   { name: 'deadline', type: 'uint256' },
//   { name: 'nonce', type: 'uint256' },
//   { name: 'data', type: 'bytes' },
//   { name: 'hashedPayload', type: 'Swap' },
// ],
// };

// const RemoveLiquidityForwarderType = {
//   RemoveLiquidity: [
//     { name: 'tokenA', type: 'address' },
//     { name: 'tokenB', type: 'address' },
//     { name: 'amountADesired', type: 'uint256' },
//     { name: 'amountBDesired', type: 'uint256' },
//     { name: 'amountAMin', type: 'uint256' },
//     { name: 'amountBMin', type: 'uint256' },
//     { name: 'user', type: 'address' },
//     { name: 'deadline', type: 'uint256' },
//     { name: 'v', type: 'uint8' },
//     { name: 'r', type: 'bytes32' },
//     { name: 's', type: 'bytes32' },
//   ],
// Forwarder: [
//   { name: 'from', type: 'address' },
//   { name: 'feeToken', type: 'address' },
//   { name: 'maxTokenAmount', type: 'uint256' },
//   { name: 'deadline', type: 'uint256' },
//   { name: 'nonce', type: 'uint256' },
//   { name: 'data', type: 'bytes' },
//   { name: 'hashedPayload', type: 'RemoveLiquidity' },
// ],
// };

export const EIP712PermitType = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export const EIP712ForwarderType = {
  Forwarder: [
    { name: 'from', type: 'address' },
    { name: 'feeToken', type: 'address' },
    { name: 'maxTokenAmount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'hashedPayload', type: 'bytes32' },
  ],
};

export function hashAddLiquidityPayload(obj: AddLiquidityType): string {
  const ADDLIQUIDITY_TYPEHASH = keccak256(
    toUtf8Bytes(
      'AddLiquidity(address tokenA,address tokenB,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address user,uint256 deadline)',
    ),
  );

  return keccak256(
    defaultAbiCoder.encode(
      ['bytes', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'address', 'uint256'],
      [
        ADDLIQUIDITY_TYPEHASH,
        obj.tokenA,
        obj.tokenB,
        obj.amountADesired,
        obj.amountBDesired,
        obj.amountAMin,
        obj.amountBMin,
        obj.user,
        obj.deadline,
      ],
    ),
  );
}

export function hashSwapPayload(obj: SwapType): string {
  const SWAP_TYPEHASH = keccak256(
    toUtf8Bytes('Swap(uint256 amount0,uint256 amount1,address[] path,address user,uint256 deadline)'),
  );

  return keccak256(
    defaultAbiCoder.encode(
      ['bytes', 'uint256', 'uint256', 'bytes32', 'address', 'uint256'],
      [
        SWAP_TYPEHASH,
        obj.amount0,
        obj.amount1,
        keccak256(solidityPack(['address[]'], [obj.path])),
        obj.user,
        obj.deadline,
      ],
    ),
  );
}

export function hashRemoveLiquidityPayload(obj: RemoveLiquidityType, sig: Signature): string {
  const REMOVE_LIQUIDITY_TYPEHASH = keccak256(
    toUtf8Bytes(
      'RemoveLiquidity(address tokenA,address tokenB,uint256 liquidity,uint256 amountAMin,uint256 amountBMin,address user,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
    ),
  );

  return keccak256(
    defaultAbiCoder.encode(
      [
        'bytes',
        'address',
        'address',
        'uint256',
        'uint256',
        'uint256',
        'address',
        'uint256',
        'uint8',
        'bytes32',
        'bytes32',
      ],
      [
        REMOVE_LIQUIDITY_TYPEHASH,
        obj.tokenA,
        obj.tokenB,
        obj.liquidity,
        obj.amountAMin,
        obj.amountBMin,
        obj.user,
        obj.deadline,
        sig.v,
        sig.r,
        sig.s,
      ],
    ),
  );
}

export function getPermitMessage(obj: PermitType, nonce: BigNumber): TypedPermit {
  return {
    owner: obj.owner,
    spender: obj.spender,
    value: obj.value,
    nonce: nonce,
    deadline: obj.deadline,
  };
}

export function getForwarderMessage(obj: MetaTxType): TypedForwarder {
  return {
    from: obj.from,
    feeToken: obj.feeToken,
    maxTokenAmount: obj.maxTokenAmount,
    deadline: obj.deadline,
    nonce: obj.nonce,
    data: obj.data,
    hashedPayload: obj.hashedPayload,
  };
}

export async function signEIP712(
  signer: SignerWithAddress,
  domain: TypedDomain,
  messageType: typeof EIP712PermitType | typeof EIP712ForwarderType,
  content: TypedPermit | TypedForwarder,
): Promise<Signature> {
  const signature = await signer._signTypedData(domain, messageType, content);
  return splitSignature(signature);
}
