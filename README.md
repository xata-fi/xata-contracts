# ConveyorV2-core

ConveyorV2 operates as an independent decentralised exchange protocol that prevents MEV and sandwich attacks by enforcing the correct ordering of incoming transactions.

This repo contains the smart contracts of ConveyorV2, which was originally forked from [uniswap-v2-core](https://github.com/Uniswap/uniswap-v2-core).

## Development

Run the following command to install all dependencies.

```shell
yarn install
```

To compile the contracts, run

```shell
yarn compile
```

This repository is developed using [hardhat](https://hardhat.org/) and more commands can be found through

```shell
yarn hardhat
```

To run tests from the `test/` directory, run

```shell
yarn test
```

To deploy the contracts to a network, run

```shell
yarn deploy --network <option>
```

Note: Store private keys in the `.env` file. Do not commit this file or you will be at risk of losing your funds.

---

## Network Configuration

### Local Unit Testing

|Network|Description|
|---|---|
|`hardhat`|Local ETH fork|

### Integrating Testing On Tenderly Forks

|Network|Description|
|---|---|
|`eth_tenderly`|Ethereum fork|
|`matic_tenderly`|Polygon PoS fork|
|`bsc_tenderly`|Binance Smart Chain fork|

### Main nets

Note: Infura/Alchemy API keys must be configured in the `.env` file.

|Network|Description|
|---|---|
|`eth`|Ethereum|
|`matic`|Polygon PoS|
|`bsc`|Binance Smart Chain|

---

## Contracts

Contracts are deployed to the following addresses.

|Contract|Address|Network|
|---|---|---|
|ConveyorV2Factory|`0x5f8017621825BC10D63d15C3e863f893946781F7`|BSC, Polygon|
|ConveyorV2Router01|`0xe4C5Cf259351d7877039CBaE0e7f92EB2Ab017EB`|BSC, Polygon|
|Create2Deployer|`0x92CACc70175Dc0fE30B44eaddaD03bF551aCB430`|BSC, Polygon|
