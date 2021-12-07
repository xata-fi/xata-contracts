import { ConveyorV2Router01 } from '../../typechain';
import { BigNumber } from 'ethers';
import { networkIsLocal, getAccounts, loadERC20instance, formatERC20Amount, sinceNow } from '../../lib/utils';

import { AddLiquidityType } from '../../lib/types';

export default async function addLiquidity(
  router: ConveyorV2Router01,
  tokenA: string,
  tokenB: string,
  minAmount: BigNumber,
  desiredAmount: BigNumber,
  delay: number,
  verbose = false,
) {
  const metaEnabled = await router.metaEnabled();
  if (metaEnabled) {
    throw new Error('Error: Meta enabled!');
  } else if (networkIsLocal) {
    const { user } = await getAccounts();
    const A = await loadERC20instance(tokenA);
    const B = await loadERC20instance(tokenB);
    const fee = BigNumber.from(1);
    const min_a = formatERC20Amount(minAmount, await A.decimals());
    const desired_a = formatERC20Amount(desiredAmount, await A.decimals());
    const min_b = formatERC20Amount(minAmount, await B.decimals());
    const desired_b = formatERC20Amount(desiredAmount, await B.decimals());
    const liquidity_object: AddLiquidityType = {
      tokenA: tokenA,
      tokenB: tokenB,
      amountADesired: desired_a,
      amountBDesired: desired_b,
      amountAMin: min_a,
      amountBMin: min_b,
      user: user.address,
      deadline: sinceNow(delay),
    };
    try {
      const max = '1000000000000000000000000000000';
      await A.connect(user).approve(router.address, BigNumber.from(max));
      await B.connect(user).approve(router.address, BigNumber.from(max));
      await router.connect(user).addLiquidity(liquidity_object);
      if (verbose) {
        console.log(`Successfully added liquidity to the ${await A.symbol()}-${await B.symbol()} pool`);
      }
    } catch (error) {
      console.log(error);
    }
  } else {
    console.log('002_addLiquidity: Unsupported method. Local testing only.');
  }
}
