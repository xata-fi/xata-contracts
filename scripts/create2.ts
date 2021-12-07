import { deployCreate2 } from './deploy/000_preflight';

async function main() {
  await deployCreate2(true);
}

main()
  .then(() => process.exit(0))
  .catch((e) => console.log(e));
