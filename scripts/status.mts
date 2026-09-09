import "dotenv/config";
import { formatEther } from "viem";
import { contractAddress } from "../lib/chain";
import { publicClient } from "../lib/relayer";
import { query } from "../lib/subgraph";
import { wwwcAbi } from "../lib/wwwc-abi";

const onchain = await publicClient.readContract({
  address: contractAddress, abi: wwwcAbi, functionName: "toiletCount",
});
const balance = await publicClient.getBalance({
  address: "0x83e4Ff2CAA34fB79a65A926671Cc142172774d75",
});

const data = await query<{
  global: Record<string, string> | null;
  _meta: { block: { number: number }; hasIndexingErrors: boolean };
  toilets: { name: string; access: string; source: string; sourceUrl: string }[];
}>(`{
  global(id: "global") { toiletCount humanToilets agentToilets contributorCount totalWeight totalDonated }
  _meta { block { number } hasIndexingErrors }
  toilets(first: 5, orderBy: createdAt, orderDirection: desc) { name access source sourceUrl }
}`);

console.log("contract toiletCount :", onchain);
console.log("subgraph  toiletCount:", data.global?.toiletCount ?? "no global yet");
console.log("subgraph  head block :", data._meta.block.number, "errors:", data._meta.hasIndexingErrors);
console.log("relayer   balance    :", formatEther(balance), "ETH");
console.log("\nglobal:", JSON.stringify(data.global));
console.log("\nmost recent:");
for (const t of data.toilets) console.log(` ${(t.name || "(unnamed)").padEnd(34)} ${t.access.padEnd(9)} ${t.source.padEnd(6)} ${t.sourceUrl}`);
