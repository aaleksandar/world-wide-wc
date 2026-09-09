import "dotenv/config";
import { readFileSync } from "node:fs";
import { contractAddress } from "../lib/chain";
import { publicClient } from "../lib/relayer";
import { wwwcAbi } from "../lib/wwwc-abi";

const count = await publicClient.readContract({
  address: contractAddress, abi: wwwcAbi, functionName: "toiletCount",
});
console.log("toiletCount on chain:", count);

const ledger = JSON.parse(readFileSync("data/submitted-london.json", "utf8")) as Record<string, string>;
for (const [key, hash] of Object.entries(ledger)) {
  const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` }).catch(() => null);
  console.log(
    key.padEnd(22),
    hash.slice(0, 12),
    receipt ? `${receipt.status} block ${receipt.blockNumber} logs ${receipt.logs.length}` : "NOT MINED",
  );
}
