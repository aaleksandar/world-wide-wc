import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, contractAddress, rpcUrl } from "./chain";
import { wwwcAbi } from "./wwwc-abi";

/**
 * Server and scripts only — never import this into a client component. The private key
 * is not NEXT_PUBLIC_, so a browser would get `undefined` and throw, but the guard below
 * says so plainly rather than failing three frames deep in viem.
 *
 * The wallet that pays gas so contributors don't have to. It holds nothing but faucet ETH
 * and its only power is calling logFor/rateFor — it cannot move donations, and it cannot
 * change who the relayer is. That authority stays with the contract owner.
 */

export const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

let cached: ReturnType<typeof createWalletClient> | null = null;

export function relayerClient() {
  if (cached) return cached;

  if (typeof window !== "undefined") {
    throw new Error("relayerClient() is server-side only");
  }

  const key = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key || key === "0x") throw new Error("RELAYER_PRIVATE_KEY is not set");
  if (!contractAddress) throw new Error("NEXT_PUBLIC_WWWC_ADDRESS is not set");

  cached = createWalletClient({
    account: privateKeyToAccount(key),
    chain,
    transport: http(rpcUrl),
  });
  return cached;
}

export async function relayToiletLog(args: {
  contributor: `0x${string}`;
  lat: number;
  lng: number;
  payload: string;
  isAgent: boolean;
}) {
  const wallet = relayerClient();
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: wwwcAbi,
    functionName: "logFor",
    args: [args.contributor, args.lat, args.lng, args.payload, args.isAgent],
    chain,
    account: wallet.account!,
  });
  return hash;
}

export async function relayRating(args: {
  toiletId: bigint;
  rater: `0x${string}`;
  payload: string;
}) {
  const wallet = relayerClient();
  return wallet.writeContract({
    address: contractAddress,
    abi: wwwcAbi,
    functionName: "rateFor",
    args: [args.toiletId, args.rater, args.payload],
    chain,
    account: wallet.account!,
  });
}
