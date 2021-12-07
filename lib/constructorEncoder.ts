import { utils } from 'ethers';

const { defaultAbiCoder } = utils;

// greeter
export function encodeGreeterConstrustor(_greeting: string, _trustedRelayer: string): string {
  return defaultAbiCoder.encode(['string', 'address'], [_greeting, _trustedRelayer]);
}

// factory
export function encodeFactoryConstructor(_deployerAddress: string): string {
  return defaultAbiCoder.encode(['address'], [_deployerAddress]);
}

// router
export function encodeRouterConstructor(_factoryAddress: string): string {
  return defaultAbiCoder.encode(['address'], [_factoryAddress]);
}
