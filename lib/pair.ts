import { utils } from 'ethers';
import * as lib from './constants';

export function pair(address1: string, address2: string, factoryAddr: string): string {
  const addr1 = utils.arrayify(address1);
  const addr2 = utils.arrayify(address2);
  const token_pair = address1.localeCompare(address2) < 1 ? [...addr1, ...addr2] : [...addr2, ...addr1];
  const token_pair_hash = utils.arrayify(utils.keccak256(token_pair));
  const factory = utils.arrayify(factoryAddr);
  const init_code_hash = utils.arrayify(lib.INIT_CODE_HASH);
  const pair_data = [0xff, ...factory, ...token_pair_hash, ...init_code_hash];
  const hash = utils.keccak256(pair_data);
  return `0x${hash.substring(26)}`;
}
