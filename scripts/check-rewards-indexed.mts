import "dotenv/config";
import { formatEther } from "viem";
import { query } from "../lib/subgraph";

const data = await query<{
  global: { totalDonated: string; totalClaimed: string; contributorCount: number };
  donations: { amount: string; note: string; donor: string }[];
  contributors: { id: string; weight: string; claimed: string; toiletsLogged: number }[];
}>(`{
  global(id: "global") { totalDonated totalClaimed contributorCount }
  donations(first: 5, orderBy: createdAt, orderDirection: desc) { amount note donor }
  contributors(first: 5, orderBy: weight, orderDirection: desc) { id weight claimed toiletsLogged }
}`);

console.log("global    donated", formatEther(BigInt(data.global.totalDonated)),
            "· claimed", formatEther(BigInt(data.global.totalClaimed)),
            "· contributors", data.global.contributorCount);
console.log("\ndonations:");
for (const d of data.donations) console.log(` ${formatEther(BigInt(d.amount))} ETH  "${d.note}"`);
console.log("\nleaderboard:");
for (const c of data.contributors)
  console.log(` ${c.id}  weight ${c.weight}  logged ${c.toiletsLogged}  claimed ${formatEther(BigInt(c.claimed))} ETH`);
