/**
 * The subgraph replicates the contract's reward accumulator so the leaderboard is one
 * GraphQL query instead of an RPC call per contributor. Two copies of the same maths can
 * drift, so this compares them for every contributor the subgraph knows about.
 *
 *   npx tsx scripts/check-earnings.mts
 */
import "dotenv/config";
import { formatEther } from "viem";
import { contractAddress } from "../lib/chain";
import { publicClient } from "../lib/relayer";
import { query } from "../lib/subgraph";
import { wwwcAbi } from "../lib/wwwc-abi";

type Row = { id: string; weight: string; accrued: string; rewardDebt: string; claimed: string };

const data = await query<{
  global: { accPerWeight: string; poolPending: string; totalWeight: string; totalDonated: string };
  contributors: Row[];
}>(`{
  global(id: "global") { accPerWeight poolPending totalWeight totalDonated }
  contributors(first: 100) { id weight accrued rewardDebt claimed }
}`);

if (!data.global) throw new Error("subgraph has no global row yet");

const accPerWeight = BigInt(data.global.accPerWeight);
console.log(`subgraph: accPerWeight ${accPerWeight} · poolPending ${data.global.poolPending} wei`);
console.log(`          totalWeight ${data.global.totalWeight} · donated ${formatEther(BigInt(data.global.totalDonated))} ETH\n`);

let mismatches = 0;

for (const row of data.contributors) {
  // The same expression the contract's pendingOf() evaluates.
  const computed =
    BigInt(row.accrued) + BigInt(row.weight) * accPerWeight - BigInt(row.rewardDebt);

  const onchain = (await publicClient.readContract({
    address: contractAddress, abi: wwwcAbi, functionName: "pendingOf", args: [row.id as `0x${string}`],
  })) as bigint;

  const ok = computed === onchain;
  if (!ok) mismatches++;

  console.log(
    `${ok ? "✓" : "✗"} ${row.id}`,
    `\n    weight ${row.weight} · claimed ${formatEther(BigInt(row.claimed))} ETH`,
    `\n    pending  subgraph ${computed}  contract ${onchain}`,
    `\n    earned   ${formatEther(computed + BigInt(row.claimed))} ETH (claimed + pending)`,
  );
}

if (mismatches) {
  console.error(`\n${mismatches} contributor(s) disagree — the mapping has drifted from the contract`);
  process.exit(1);
}
console.log(`\n✓ subgraph and contract agree on every contributor's pending balance`);
