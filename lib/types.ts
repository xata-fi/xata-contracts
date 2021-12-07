import { BigNumber } from 'ethers';

export interface AddLiquidityType {
  tokenA: string;
  tokenB: string;
  amountADesired: BigNumber;
  amountBDesired: BigNumber;
  amountAMin: BigNumber;
  amountBMin: BigNumber;
  user: string;
  deadline: BigNumber;
}

export interface SwapType {
  amount0: BigNumber;
  amount1: BigNumber;
  path: string[];
  user: string;
  deadline: BigNumber;
}

export interface RemoveLiquidityType {
  tokenA: string;
  tokenB: string;
  liquidity: BigNumber;
  amountAMin: BigNumber;
  amountBMin: BigNumber;
  user: string;
  deadline: BigNumber;
}

export interface PermitType {
  owner: string;
  spender: string;
  value: BigNumber;
  deadline: BigNumber;
}

export interface MetaTxType {
  from: string;
  feeToken: string;
  maxTokenAmount: BigNumber;
  deadline: BigNumber;
  nonce: BigNumber;
  data: string;
  hashedPayload: string;
}
