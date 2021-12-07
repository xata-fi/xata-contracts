//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ERC20Forwarder is Ownable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    uint256 constantFee = 21000;
    uint256 transferFee = 65000;
    mapping(address => bool) public relayers;
    address public feeHolder;

    // EIP 712
    // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 public constant DOMAIN_TYPEHASH = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
    // keccak256("Forwarder(address from,address feeToken,uint256 maxTokenAmount,uint256 deadline,uint256 nonce,bytes data,bytes32 hashedPayload)")
    bytes32 public constant FORWARDER_TYPEHASH = 0xef1224019adeddaa744f5c3109d745485aa3a6c424cb8457450389e20dfc4d5c;
    mapping(address => uint256) public nonces;

    event MetaStatus(address sender, bool success, string error);

    struct MetaTransaction {
        address from;
        address feeToken;
        uint256 maxTokenAmount;
        uint256 deadline;
        uint256 nonce;
        bytes data;
        bytes32 hashedPayload;
    }

    struct SIGNATURE_TYPE {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    constructor() {
        feeHolder = msg.sender;
    }

    modifier relayerOnly() {
        require(relayers[msg.sender], "ERC20ForwarderError: Unauthorized Caller!");
        _;
    }

    function setConstantFee(uint256 _newConstantFee) public onlyOwner {
        constantFee = _newConstantFee;
    }

    function setTransferFee(uint256 _newTransferFee) public onlyOwner {
        transferFee = _newTransferFee;
    }

    function setRelayer(address _relayer, bool _trusted) public onlyOwner {
        relayers[_relayer] = _trusted;
    }

    function setFeeHolder(address _feeHolder) public onlyOwner {
        feeHolder = _feeHolder;
    }

    function _convertBytesToBytes4(bytes memory inBytes) private pure returns (bytes4 outBytes4) {
        if (inBytes.length == 0) {
            return 0x0;
        }

        assembly {
            outBytes4 := mload(add(inBytes, 32))
        }
    }

    function _registerDomain(string memory _name) private view returns (bytes32 DOMAIN_SEPARATOR) {
        uint256 chainId;

        assembly {
            chainId := chainid()
        }

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(_name)), keccak256(bytes("1")), chainId, address(this))
        );
    }

    function _generateEIP712Message(string memory _domainName, bytes32 _hashedMessage) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _registerDomain(_domainName), _hashedMessage));
    }

    function _generateHashedMessage(MetaTransaction memory metatx) private returns (bytes32) {
        return (
            keccak256(
                abi.encode(
                    FORWARDER_TYPEHASH,
                    metatx.from,
                    metatx.feeToken,
                    metatx.maxTokenAmount,
                    metatx.deadline,
                    nonces[metatx.from]++,
                    keccak256(metatx.data),
                    metatx.hashedPayload
                )
            )
        );
    }

    function _verifySignature(
        bytes32 _digest,
        address _signer,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private pure returns (bool) {
        address verifier = _digest.recover(v, r, s);
        return (_signer == verifier && _signer != address(0));
    }

    function executeMetaTx(
        MetaTransaction memory metatx,
        string memory domainName,
        uint256 tokenPricePerNativeToken,
        uint256 feeOffset,
        SIGNATURE_TYPE memory sig
    ) public relayerOnly returns (bool success, bytes memory data) {
        uint256 startingGas = gasleft();
        {
            // performing necessary checks. any point of reverts will not be refunded.
            uint256 total = metatx.maxTokenAmount + feeOffset;
            require(
                IERC20(metatx.feeToken).balanceOf(metatx.from) >= total,
                "ERC20ForwarderError: Insufficient balance"
            );
            uint256 fee = (startingGas * tokenPricePerNativeToken * tx.gasprice) / (10**18);
            require(total >= fee, "ERC20ForwarderError: Insufficient maxTokenAmount");
            bytes32 hashedMessage = _generateHashedMessage(metatx);
            bytes32 digest = _generateEIP712Message(domainName, hashedMessage);
            require(
                _verifySignature(digest, metatx.from, sig.v, sig.r, sig.s),
                "ERC20ForwarderError: Invalid signature"
            );
        }
        bytes4 destinationFunctionSig = _convertBytesToBytes4(metatx.data);
        bool functionIsValid = destinationFunctionSig != msg.sig;
        if (functionIsValid) {
            (success, data) = address(this).call(abi.encodePacked(metatx.data, metatx.from));
            _verifyResult(metatx.from, success, data);
        } else {
            emit MetaStatus(metatx.from, false, "ERC20ForwarderFailure: Invalid function signature");
        }
        uint256 price = (tokenPricePerNativeToken * tx.gasprice); // this price has been amplified by a factor of 10**18
        uint256 executionGas = startingGas - gasleft();
        _postExecution(metatx.from, metatx.feeToken, executionGas, price);
    }

    function _verifyResult(
        address from,
        bool success,
        bytes memory data
    ) private {
        string memory errorLog;
        if (!success) {
            errorLog = _getRevertMsg(data);
        }
        emit MetaStatus(from, success, errorLog);
    }

    function _postExecution(
        address spender,
        address feeToken,
        uint256 executionGas,
        uint256 tokenPrice
    ) private {
        uint256 gasUsed = executionGas + constantFee + transferFee;
        uint256 fee = (tokenPrice * gasUsed) / (10**18); // adjust the fee to reflect the transaction fee in wei
        IERC20(feeToken).safeTransferFrom(spender, feeHolder, fee);
    }

    // Ref: https://ethereum.stackexchange.com/questions/83528/how-can-i-get-the-revert-reason-of-a-call-in-solidity-so-that-i-can-use-it-in-th
    function _getRevertMsg(bytes memory _returnData) internal pure returns (string memory) {
        // If the _res length is less than 68, then the transaction failed silently (without a revert message)
        if (_returnData.length < 68) return "Transaction reverted silently";

        assembly {
            // Slice the sighash.
            _returnData := add(_returnData, 0x04)
        }
        return abi.decode(_returnData, (string)); // All that remains is the revert string
    }

    // EIP 2771: https://eips.ethereum.org/EIPS/eip-2771
    // Append sender address to metaTx call data
    function msgSender() internal view returns (address signer) {
        signer = msg.sender;
        if (msg.data.length >= 20 && signer == address(this)) {
            assembly {
                signer := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        }
    }
}
