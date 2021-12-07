// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "./interfaces/IConveyorV2Factory.sol";
import "./ConveyorV2Pair.sol";

contract ConveyorV2Factory is IConveyorV2Factory {
    address public override feeTo;
    address public override feeToSetter;
    address public override router;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    constructor(address _feeToSetter) {
        feeToSetter = _feeToSetter;
    }

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        require(tokenA != tokenB, "ConveyorV2: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "ConveyorV2: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "ConveyorV2: PAIR_EXISTS"); // single check is sufficient
        bytes memory bytecode = type(ConveyorV2Pair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        IConveyorV2Pair(pair).initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, "ConveyorV2: FORBIDDEN");
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, "ConveyorV2: FORBIDDEN");
        feeToSetter = _feeToSetter;
    }

    function setRouter(address _router) external override {
        require(msg.sender == feeToSetter, "ConveyorV2: FORBIDDEN");
        router = _router;
    }
}
