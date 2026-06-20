// Trust Wallet Agent Kit (TWAK) integration
// Uses per-user encrypted BSC wallets (see lib/wallet.ts).
// Each user has their own isolated agent wallet — no shared keys.

import { parseUnits, parseEther } from "viem";
import { getWalletContext } from "./wallet";
import { WBNB_ADDRESS, USDT_ADDRESS, PANCAKE_V2_ROUTER } from "./bsc/tokens";

// Minimal ABIs
const ROUTER_ABI = [
  {
    inputs: [
      { name: "amountIn",     type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path",         type: "address[]" },
      { name: "to",           type: "address" },
      { name: "deadline",     type: "uint256" },
    ],
    name: "swapExactTokensForTokens",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path",         type: "address[]" },
      { name: "to",           type: "address" },
      { name: "deadline",     type: "uint256" },
    ],
    name: "swapExactETHForTokens",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "amountIn",     type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path",         type: "address[]" },
      { name: "to",           type: "address" },
      { name: "deadline",     type: "uint256" },
    ],
    name: "swapExactTokensForETH",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path",     type: "address[]" },
    ],
    name: "getAmountsOut",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface SwapResult {
  ok: boolean;
  txHash?: `0x${string}`;
  amountIn?: string;
  amountOut?: string;
  error?: string;
}

// Buy tokenOut using BNB (native BNB → WBNB → USDT → tokenOut via PancakeSwap)
export async function buyWithBNB(params: {
  encryptedKey: string;
  tokenOutAddress: `0x${string}`;
  bnbAmountEth: number;
  slippagePct?: number;
}): Promise<SwapResult> {
  const { encryptedKey, tokenOutAddress, bnbAmountEth, slippagePct = 1 } = params;
  try {
    const ctx = getWalletContext(encryptedKey);
    const amountIn = parseEther(bnbAmountEth.toFixed(18));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    const path: `0x${string}`[] = [WBNB_ADDRESS, USDT_ADDRESS, tokenOutAddress];

    const amounts = await ctx.public.readContract({
      address: PANCAKE_V2_ROUTER,
      abi: ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [amountIn, path],
    }) as bigint[];

    const expectedOut  = amounts[amounts.length - 1];
    const amountOutMin = expectedOut * BigInt(Math.floor((100 - slippagePct) * 100)) / BigInt(10000);

    const txHash = await ctx.wallet.writeContract({
      address: PANCAKE_V2_ROUTER,
      abi: ROUTER_ABI,
      functionName: "swapExactETHForTokens",
      args: [amountOutMin, path, ctx.account.address, deadline],
      value: amountIn,
    });

    return { ok: true, txHash, amountIn: bnbAmountEth.toString(), amountOut: expectedOut.toString() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Sell tokenIn back to USDT via PancakeSwap
export async function sellToUSDT(params: {
  encryptedKey: string;
  tokenInAddress: `0x${string}`;
  tokenDecimals: number;
  tokenAmount: number;
  slippagePct?: number;
}): Promise<SwapResult> {
  const { encryptedKey, tokenInAddress, tokenDecimals, tokenAmount, slippagePct = 1 } = params;
  try {
    const ctx = getWalletContext(encryptedKey);
    const amountIn = parseUnits(tokenAmount.toFixed(tokenDecimals), tokenDecimals);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
    // Route through WBNB for better liquidity on most pairs
    const path: `0x${string}`[] = tokenInAddress === WBNB_ADDRESS
      ? [WBNB_ADDRESS, USDT_ADDRESS]
      : [tokenInAddress, WBNB_ADDRESS, USDT_ADDRESS];

    // Approve router
    await ctx.wallet.writeContract({
      address: tokenInAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PANCAKE_V2_ROUTER, amountIn],
    });

    const amounts = await ctx.public.readContract({
      address: PANCAKE_V2_ROUTER,
      abi: ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [amountIn, path],
    }) as bigint[];

    const expectedOut  = amounts[amounts.length - 1];
    const amountOutMin = expectedOut * BigInt(Math.floor((100 - slippagePct) * 100)) / BigInt(10000);

    // swapExactTokensForTokens — path ends at USDT (ERC20), not native BNB
    const txHash = await ctx.wallet.writeContract({
      address: PANCAKE_V2_ROUTER,
      abi: ROUTER_ABI,
      functionName: "swapExactTokensForTokens",
      args: [amountIn, amountOutMin, path, ctx.account.address, deadline],
    });

    return { ok: true, txHash, amountIn: tokenAmount.toString(), amountOut: expectedOut.toString() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
