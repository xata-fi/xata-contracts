import { BigNumber, Contract, Signer } from 'ethers';
import { ethers as hreEthers } from 'hardhat';
import { Pair, Percent, Route, Token, TokenAmount, Trade, TradeType } from '@uniswap/sdk';
import { pair } from './pair';
import { abi as pairAbi } from '../artifacts/contracts/ConveyorV2Pair.sol/ConveyorV2Pair.json';

export async function getArgumentsForSwapExactTokensForTokens(tokens: Token[], inputA: BigNumber, factory: string) {
  const p: Pair[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const pair = await fetchPairData(tokens[i - 1], tokens[i], hreEthers.provider, factory);
    p.push(pair);
  }
  const route = new Route(p, tokens[0]);
  const trade = new Trade(route, new TokenAmount(tokens[0], inputA.toString()), TradeType.EXACT_INPUT);

  const slippageTolerance = new Percent('50', '10000'); // 0.5%
  const amountOutMin = trade.minimumAmountOut(slippageTolerance).raw;
  return {
    amountOutMin: BigNumber.from(amountOutMin.toString()),
    route,
  };
}

export async function getArgumentsForSwapTokensForExactTokens(tokens: Token[], outputA: BigNumber, factory: string) {
  const p: Pair[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const pair = await fetchPairData(tokens[i - 1], tokens[i], hreEthers.provider, factory);
    p.push(pair);
  }
  const route = new Route(p, tokens[0]);
  const trade = new Trade(
    route,
    new TokenAmount(tokens[tokens.length - 1], outputA.toString()),
    TradeType.EXACT_OUTPUT,
  );

  const slippageTolerance = new Percent('50', '10000'); // 0.5%
  const amountInMax = trade.maximumAmountIn(slippageTolerance).raw; // needs to be converted to e.g. hex
  return {
    amountInMax: BigNumber.from(amountInMax.toString()),
    route,
  };
}

/**
 * Fetches information about a pair and constructs a pair from the given two tokens.
 * @param tokenA first token
 * @param tokenB second token
 * @param provider the provider to use to fetch the data
 * @param factory the factory address
 */
async function fetchPairData(
  tokenA: Token,
  tokenB: Token,
  provider = hreEthers.getDefaultProvider(hreEthers.providers.getNetwork(tokenA.chainId)),
  factory: string,
): Promise<Pair> {
  const address = pair(tokenA.address, tokenB.address, factory);
  const [reserves0, reserves1] = await new Contract(address, pairAbi, provider).getReserves();
  const balances = tokenA.sortsBefore(tokenB) ? [reserves0, reserves1] : [reserves1, reserves0];
  return new Pair(new TokenAmount(tokenA, balances[0]), new TokenAmount(tokenB, balances[1]));
}
