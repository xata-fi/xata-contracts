import {
  DAI_HOLDER,
  USDC_HOLDER,
  USDT_HOLDER,
  ATA_HOLDER,
  DAI_ERC20,
  USDC_ERC20,
  USDT_ERC20,
  ATA_ERC20,
} from '../../lib/constants';
import {
  networkIsLocal,
  impersonateSigner,
  formatERC20Amount,
  loadERC20instance,
  parseERC20Amount,
} from '../../lib/utils';
import { BigNumber } from 'ethers';

export default async function fundERC20ToUser(userAddr: string, amount: BigNumber, verbose = false) {
  if (networkIsLocal) {
    const tokens = [DAI_ERC20, USDC_ERC20, USDT_ERC20, ATA_ERC20];
    const accountToImpersonate = [DAI_HOLDER, USDC_HOLDER, USDT_HOLDER, ATA_HOLDER];
    const n = tokens.length;
    for (let i = 0; i < n; i++) {
      const asset = await loadERC20instance(tokens[i]);
      const holder = await impersonateSigner(accountToImpersonate[i]);
      const decimals = await asset.decimals();
      await asset.connect(holder).transfer(userAddr, formatERC20Amount(amount, decimals));
      const bal = await asset.balanceOf(userAddr);
      const adjusted_bal = parseERC20Amount(bal, decimals);
      if (verbose) {
        console.log(`Funded ${adjusted_bal} ${await asset.symbol()} to ${userAddr}`);
      }
    }
  } else {
    console.log('001_Fund: Unsupported method. Local testing only.');
  }
}
