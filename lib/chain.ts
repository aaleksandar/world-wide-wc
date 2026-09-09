import { baseSepolia } from "viem/chains";

/**
 * Everything chain-shaped lives here, so moving to another network is a config change
 * rather than a search-and-replace. Base Sepolia is where we build: faucet gas, a free
 * x402 facilitator, and Subgraph Studio indexes it.
 */
export const chain = baseSepolia;

export const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

export const contractAddress = (process.env.NEXT_PUBLIC_WWWC_ADDRESS ?? "") as `0x${string}`;

export const explorerTxUrl = (hash: string) => `${chain.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddressUrl = (address: string) =>
  `${chain.blockExplorers.default.url}/address/${address}`;

/** Latitude and longitude are stored onchain as int32 at 1e6 scale. */
export const COORD_SCALE = 1_000_000;
export const toChainCoord = (degrees: number) => Math.round(degrees * COORD_SCALE);
export const fromChainCoord = (scaled: number | string) => Number(scaled) / COORD_SCALE;
