import "dotenv/config";
import { createPublicClient, formatEther, http } from "viem";
import { baseSepolia } from "viem/chains";

const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
const hash = process.argv[2] as `0x${string}`;
const watch = process.argv[3] as `0x${string}` | undefined;

if (watch) console.log("balance of", watch, formatEther(await client.getBalance({ address: watch })), "ETH");

const tx = await client.getTransaction({ hash }).catch((e: Error) => e.name);
if (typeof tx === "string") {
  console.log("transaction not found on Base Sepolia:", tx);
} else {
  console.log("from  ", tx.from);
  console.log("to    ", tx.to);
  console.log("value ", formatEther(tx.value), "ETH");
  console.log("block ", tx.blockNumber);
}
