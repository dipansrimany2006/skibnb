// Injected Cosmos wallet providers (Keplr, Leap, Ninji), accessed the same way
// Hodegos does — directly off the window, no wallet-kit library.

interface CosmosOfflineSigner {
  getAccounts: () => Promise<{ address: string }[]>;
}

interface CosmosWalletProvider {
  enable: (chainId: string) => Promise<void>;
  getOfflineSigner: (chainId: string) => CosmosOfflineSigner;
  getKey?: (chainId: string) => Promise<{ bech32Address: string }>;
}

interface Window {
  keplr?: CosmosWalletProvider;
  leap?: CosmosWalletProvider;
  ninji?: CosmosWalletProvider;
}
