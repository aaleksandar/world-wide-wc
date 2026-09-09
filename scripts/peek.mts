import "dotenv/config";
import { formatEther } from "viem";
import { contractAddress } from "../lib/chain";
import { publicClient } from "../lib/relayer";
import { wwwcAbi } from "../lib/wwwc-abi";
const me = "0x83e4Ff2CAA34fB79a65A926671Cc142172774d75" as const;
const r = (fn: string, args?: unknown[]) =>
  publicClient.readContract({ address: contractAddress, abi: wwwcAbi, functionName: fn, args } as never) as Promise<bigint>;
const rec = await publicClient.getTransactionReceipt({
  hash: "0x84313f3f728d73646ec19f4c385d69023881865052bdf5dbefa825a161e4deed",
});
console.log("donate tx:", rec.status, "block", rec.blockNumber, "logs", rec.logs.length);
console.log("head block:", await publicClient.getBlockNumber());
console.log("totalDonated", formatEther(await r("totalDonated")));
console.log("pendingOf   ", formatEther(await r("pendingOf", [me])));
console.log("held        ", formatEther(await publicClient.getBalance({ address: contractAddress })));
