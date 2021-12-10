import { HardhatUserConfig } from 'hardhat/types';
import '@nomiclabs/hardhat-ethers';
import '@typechain/hardhat';

// env
import dotenv from 'dotenv';
dotenv.config();

// import task
import './scripts/task/tasks';

const { ALCHEMY_API, DEPLOYER_PRIVATE_KEY, OWNER_PRIVATE_KEY } = process.env;

const mnemonic = 'system sure trial grape behind powder west panther strike response lunar follow'; // test mnenomic. DO NOT SEND REAL ETHERS TO THIS WALLET.

const config: HardhatUserConfig = {
    solidity: {
        compilers: [{ version: '0.8.2', settings: {} }],
        overrides: {
            "contracts/ConveyorV2Router01.sol" : {
                version: '0.8.2',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200
                    }
                }
            }
        }
    },

    defaultNetwork: 'hardhat',

    networks: {
        hardhat: {
            // accounts: [{privateKey: DEPLOYER_PRIVATE_KEY!, balance: '1000000000000000000000'}], // comment out for local unit testing
            forking: {
                // url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API}`,
                blockNumber: 13002160 // pinned August 11th, 2021, 13:58 UTC +08:00,
            },
            accounts: {mnemonic: mnemonic},
            chainId: 1,
        },
        localhost: {
            url: 'http://localhost:8545',
        },
        // moonriver: {
        //     url: 'https://rpc.moonriver.moonbeam.network',
        //     accounts: [OWNER_PRIVATE_KEY!, DEPLOYER_PRIVATE_KEY!]
        // },
        // arbitrum: {
        //     url: 'https://arb1.arbitrum.io/rpc',
        //     accounts: [OWNER_PRIVATE_KEY!, DEPLOYER_PRIVATE_KEY!],
        // },
        // bsc: {
        //     url: 'https://bsc-dataseed1.defibit.io/',
        //     accounts: [OWNER_PRIVATE_KEY!, DEPLOYER_PRIVATE_KEY!]
        // },
        // eth: {
        //     url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API}`,
        //     accounts: [OWNER_PRIVATE_KEY!, DEPLOYER_PRIVATE_KEY!]
        // },
        // matic: {
        //     url:`https://polygon-rpc.com/`,
        //     accounts: [OWNER_PRIVATE_KEY!, DEPLOYER_PRIVATE_KEY!]
        // },
    },

    mocha: {
        timeout: 0
    }
}

export default config;