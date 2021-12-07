import { ethers } from 'hardhat';
import { ComputeHash__factory, ComputeHash } from '../typechain';

async function main() {
  const factory = (await ethers.getContractFactory('ComputeHash')) as ComputeHash__factory;
  const contract = (await factory.deploy()) as ComputeHash;
  await contract.deployed();
  console.log('init code hash: ', await contract.getHash());
}

main()
  .then(() => process.exit(0))
  .catch((e) => console.log(e));
