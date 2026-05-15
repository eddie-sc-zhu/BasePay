import { erc20Abi } from "viem";

/** ERC-20 + the EIP-2612 / FiatToken extras USDC exposes. */
export const usdcAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export const routerAbi = [
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "ref", type: "bytes32" },
      { name: "memo", type: "string" },
    ],
    outputs: [{ name: "paymentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "payWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "ref", type: "bytes32" },
      { name: "memo", type: "string" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ name: "paymentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "createRequest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
      { name: "memo", type: "string" },
    ],
    outputs: [{ name: "requestId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "payRequest",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [{ name: "paymentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "payRequestWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [{ name: "paymentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "requests",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "payee", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "payer", type: "address" },
      { name: "memo", type: "string" },
    ],
  },
  {
    type: "event",
    name: "RequestCreated",
    inputs: [
      { name: "requestId", type: "bytes32", indexed: true },
      { name: "payee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
      { name: "memo", type: "string", indexed: false },
    ],
  },
] as const;

export const REQUEST_STATUS = ["None", "Open", "Paid", "Cancelled"] as const;
