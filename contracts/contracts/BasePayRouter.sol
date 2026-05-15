// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BasePayRouter
/// @notice Routes USDC payments on Base with on-chain memos, references and
///         payment requests (invoices). Supports EIP-2612 permit so a payer can
///         check out with a single signature + a single transaction.
contract BasePayRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 100; // 1%
    uint256 public constant MAX_MEMO_LENGTH = 140;

    enum RequestStatus {
        None,
        Open,
        Paid,
        Cancelled
    }

    struct PaymentRequest {
        address payee;
        uint256 amount;
        uint64 expiresAt; // 0 = never expires
        RequestStatus status;
        address payer;
        string memo;
    }

    IERC20 public immutable usdc;
    uint16 public feeBps;
    address public feeRecipient;
    uint256 public paymentCount;
    uint256 public requestNonce;

    mapping(bytes32 => PaymentRequest) public requests;

    event PaymentSent(
        uint256 indexed paymentId,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 fee,
        bytes32 ref,
        string memo
    );
    event RequestCreated(bytes32 indexed requestId, address indexed payee, uint256 amount, uint64 expiresAt, string memo);
    event RequestPaid(bytes32 indexed requestId, address indexed payer, uint256 paymentId);
    event RequestCancelled(bytes32 indexed requestId);
    event FeeUpdated(uint16 feeBps, address feeRecipient);

    error ZeroAddress();
    error ZeroAmount();
    error FeeTooHigh();
    error MemoTooLong();
    error RequestNotOpen();
    error RequestExpired();
    error NotPayee();
    error InvalidExpiry();

    constructor(IERC20 usdc_, address owner_, uint16 feeBps_, address feeRecipient_) Ownable(owner_) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
        _setFee(feeBps_, feeRecipient_);
    }

    // ---------------------------------------------------------------------
    // Direct payments
    // ---------------------------------------------------------------------

    /// @notice Pay `amount` USDC to `to`. Requires prior allowance to this router.
    function pay(address to, uint256 amount, bytes32 ref, string calldata memo)
        external
        nonReentrant
        returns (uint256 paymentId)
    {
        return _pay(msg.sender, to, amount, ref, memo);
    }

    /// @notice Pay using an EIP-2612 permit signature instead of a separate approve tx.
    function payWithPermit(
        address to,
        uint256 amount,
        bytes32 ref,
        string calldata memo,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 paymentId) {
        _tryPermit(amount, deadline, v, r, s);
        return _pay(msg.sender, to, amount, ref, memo);
    }

    // ---------------------------------------------------------------------
    // Payment requests (invoices / checkout links)
    // ---------------------------------------------------------------------

    function createRequest(uint256 amount, uint64 expiresAt, string calldata memo)
        external
        returns (bytes32 requestId)
    {
        if (amount == 0) revert ZeroAmount();
        if (bytes(memo).length > MAX_MEMO_LENGTH) revert MemoTooLong();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry();

        requestId = keccak256(abi.encode(block.chainid, address(this), msg.sender, ++requestNonce));
        requests[requestId] = PaymentRequest({
            payee: msg.sender,
            amount: amount,
            expiresAt: expiresAt,
            status: RequestStatus.Open,
            payer: address(0),
            memo: memo
        });
        emit RequestCreated(requestId, msg.sender, amount, expiresAt, memo);
    }

    function cancelRequest(bytes32 requestId) external {
        PaymentRequest storage req = requests[requestId];
        if (req.status != RequestStatus.Open) revert RequestNotOpen();
        if (req.payee != msg.sender) revert NotPayee();
        req.status = RequestStatus.Cancelled;
        emit RequestCancelled(requestId);
    }

    function payRequest(bytes32 requestId) external nonReentrant returns (uint256 paymentId) {
        return _payRequest(requestId);
    }

    function payRequestWithPermit(bytes32 requestId, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 paymentId)
    {
        _tryPermit(requests[requestId].amount, deadline, v, r, s);
        return _payRequest(requestId);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Returns the fee and the amount the recipient receives for a gross `amount`.
    function quote(uint256 amount) public view returns (uint256 fee, uint256 net) {
        fee = (amount * feeBps) / 10_000;
        net = amount - fee;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setFee(uint16 feeBps_, address feeRecipient_) external onlyOwner {
        _setFee(feeBps_, feeRecipient_);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _payRequest(bytes32 requestId) internal returns (uint256 paymentId) {
        PaymentRequest storage req = requests[requestId];
        if (req.status != RequestStatus.Open) revert RequestNotOpen();
        if (req.expiresAt != 0 && block.timestamp > req.expiresAt) revert RequestExpired();

        req.status = RequestStatus.Paid;
        req.payer = msg.sender;
        paymentId = _pay(msg.sender, req.payee, req.amount, requestId, req.memo);
        emit RequestPaid(requestId, msg.sender, paymentId);
    }

    function _pay(address from, address to, uint256 amount, bytes32 ref, string memory memo)
        internal
        returns (uint256 paymentId)
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (bytes(memo).length > MAX_MEMO_LENGTH) revert MemoTooLong();

        (uint256 fee, uint256 net) = quote(amount);
        usdc.safeTransferFrom(from, to, net);
        if (fee > 0) usdc.safeTransferFrom(from, feeRecipient, fee);

        paymentId = ++paymentCount;
        emit PaymentSent(paymentId, from, to, amount, fee, ref, memo);
    }

    /// @dev Permit is wrapped in try/catch so a front-run permit (which consumes the
    ///      nonce but still sets the allowance) cannot grief the payment.
    function _tryPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) internal {
        try IERC20Permit(address(usdc)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
    }

    function _setFee(uint16 feeBps_, address feeRecipient_) internal {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (feeBps_ > 0 && feeRecipient_ == address(0)) revert ZeroAddress();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeUpdated(feeBps_, feeRecipient_);
    }
}
