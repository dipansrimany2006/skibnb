// BSC token registry — addresses on BSC mainnet (chain ID 56)
// All prices in USDT pairs via PancakeSwap V2

export interface BSCToken {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  binancePair: string;   // Binance API trading pair for OHLCV
  pythSymbol: string;    // Pyth symbol fallback for candles
}

// WBNB is used as the intermediate token for BNB swaps
export const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as const;
export const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955" as const;
export const PANCAKE_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as const;
export const BSC_CHAIN_ID = 56;

export const BSC_TOKENS: BSCToken[] = [
  {
    symbol: "BNB",
    name: "BNB",
    address: WBNB_ADDRESS,
    decimals: 18,
    binancePair: "BNBUSDT",
    pythSymbol: "Crypto.BNB/USD",
  },
  {
    symbol: "CAKE",
    name: "PancakeSwap",
    address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    decimals: 18,
    binancePair: "CAKEUSDT",
    pythSymbol: "Crypto.CAKE/USD",
  },
  {
    symbol: "ETH",
    name: "Ethereum (BSC)",
    address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    decimals: 18,
    binancePair: "ETHUSDT",
    pythSymbol: "Crypto.ETH/USD",
  },
  {
    symbol: "BTC",
    name: "Bitcoin (BSC)",
    address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    decimals: 18,
    binancePair: "BTCUSDT",
    pythSymbol: "Crypto.BTC/USD",
  },
];

export function getBSCToken(symbol: string): BSCToken | undefined {
  return BSC_TOKENS.find(t => t.symbol === symbol);
}

// Display symbols used in the CFO engine (matches Pyth format: "BNB/USD")
export const BSC_DISPLAY_SYMBOLS = BSC_TOKENS.map(t => `${t.symbol}/USD`);
