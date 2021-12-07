import { utils, Signature, BigNumber } from 'ethers';
import { AddLiquidityType, SwapType, RemoveLiquidityType, MetaTxType } from './types';

const sig_tuple = 'tuple(uint8 v, bytes32 r, bytes32 s)';

const setGreeterSig = ['function setGreeting(string memory _greeting)'];
const setGreeterIFace = new utils.Interface(setGreeterSig);
export function encodeSetGreeter(greeting: string): string {
  return setGreeterIFace.encodeFunctionData('setGreeting', [greeting]);
}
export const setGreeterSigHash = setGreeterIFace.getSighash('setGreeting');

const metatx_tuple =
  'tuple(address from, address feeToken, uint256 maxTokenAmount, uint256 deadline, uint256 nonce, bytes data, bytes32 hashedPayload)';
const executeMetaTxSig = [
  `function executeMetaTx(${metatx_tuple}, string memory domainName, uint256 tokenPricePerGas, uint256 feeOffset, ${sig_tuple})`,
];
const executeMetaTxIFace = new utils.Interface(executeMetaTxSig);
export function encodeExecuteMetaTx(
  metatx_obj: MetaTxType,
  domainName: string,
  tokenPricePerGas: BigNumber,
  feeOffset: BigNumber,
  sig_obj: Signature,
): string {
  return executeMetaTxIFace.encodeFunctionData('executeMetaTx', [
    metatx_obj,
    domainName,
    tokenPricePerGas,
    feeOffset,
    sig_obj,
  ]);
}
export const executeMetaTxSigHash = executeMetaTxIFace.getSighash('executeMetaTx');

const transferOwnershipSig = ['function transferOwnership(address newOwner)'];
const transferOwnershipIFace = new utils.Interface(transferOwnershipSig);
export function encodeTransferOwnership(newOwner: string): string {
  return transferOwnershipIFace.encodeFunctionData('transferOwnership', [newOwner]);
}

const addliquidity_tuple =
  'tuple(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address user, uint256 deadline)';
const addLiquiditySig = [`function addLiquidity(${addliquidity_tuple})`];
const addLiquidityIFace = new utils.Interface(addLiquiditySig);
export function encodeAddLiquidity(liquidity_obj: AddLiquidityType): string {
  return addLiquidityIFace.encodeFunctionData('addLiquidity', [liquidity_obj]);
}
export const addLiquiditySigHash = addLiquidityIFace.getSighash('addLiquidity');

const swap_tuple = 'tuple(uint256 amount0, uint256 amount1, address[] path, address user, uint256 deadline)';
const swapExactTokensForTokensSig = [`function swapExactTokensForTokens(${swap_tuple})`];
const swapTokensForExactTokensSig = [`function swapTokensForExactTokens(${swap_tuple})`];
const swapExactTokensForTokensIFace = new utils.Interface(swapExactTokensForTokensSig);
const swapTokensForExactTokensIFace = new utils.Interface(swapTokensForExactTokensSig);
export function encodeSwapExactTokensForTokens(swap_obj: SwapType): string {
  return swapExactTokensForTokensIFace.encodeFunctionData('swapExactTokensForTokens', [swap_obj]);
}
export function encodeSwapTokensForExactTokens(swap_obj: SwapType): string {
  return swapTokensForExactTokensIFace.encodeFunctionData('swapTokensForExactTokens', [swap_obj]);
}
export const swapExactTokensForTokensSigHash = swapExactTokensForTokensIFace.getSighash('swapExactTokensForTokens');
export const swapTokensForExactTokensSigHash = swapTokensForExactTokensIFace.getSighash('swapTokensForExactTokens');

const removeLiquidity_tuple =
  'tuple(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address user, uint256 deadline)';
const removeLiquidityWithPermitSig = [`function removeLiquidityWithPermit(${removeLiquidity_tuple},${sig_tuple})`];
const removeLiquidityWithPermitIFace = new utils.Interface(removeLiquidityWithPermitSig);
export function encodeRemoveLiquidityWithPermit(remove_obj: RemoveLiquidityType, sig_obj: Signature): string {
  return removeLiquidityWithPermitIFace.encodeFunctionData('removeLiquidityWithPermit', [remove_obj, sig_obj]);
}
export const removeLiquidityWithPermitSigHash = removeLiquidityWithPermitIFace.getSighash('removeLiquidityWithPermit');
