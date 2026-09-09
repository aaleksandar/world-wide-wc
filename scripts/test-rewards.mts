/**
 * Exercises donate → accrue → claim against the deployed contract, not a local node.
 *
 *   npx tsx scripts/test-rewards.mts
 *
 * Asserts conservation rather than exact equality: the accumulator distributes whole wei
 * per unit of weight, so a donation that doesn't divide evenly leaves a remainder pending
 * for the next one. 0.001 ETH across weight 370 leaves 260 wei behind. Nothing is lost —
 * it just arrives later — and that is precisely what the assertion checks.
 */
import "dotenv/config";
import { decodeEventLog, formatEther, parseEther } from "viem";
import { contractAddress, explorerTxUrl } from "../lib/chain";
import { publicClient, relayerClient } from "../lib/relayer";
import { readUntil } from "../lib/rpc";
import { wwwcAbi } from "../lib/wwwc-abi";

const wallet = relayerClient();
const me = wallet.account!.address;
const contract = { address: contractAddress, abi: wwwcAbi } as const;

const read = (functionName: string, args?: unknown[]) =>
  publicClient.readContract({ ...contract, functionName, args } as never) as Promise<bigint>;

const readAfter = (fn: string, args: unknown[] | undefined, changedFrom: bigint) =>
  readUntil(() => read(fn, args), (value) => value !== changedFrom, { label: fn });

async function state(label: string) {
  const [donated, totalWeight, myWeight, pending, poolPending, held] = await Promise.all([
    read("totalDonated"),
    read("totalWeight"),
    read("weightOf", [me]),
    read("pendingOf", [me]),
    read("poolPending"),
    publicClient.getBalance({ address: contractAddress }),
  ]);
  console.log(
    `${label.padEnd(14)} donated ${formatEther(donated)} · weight ${myWeight}/${totalWeight} · ` +
      `claimable ${formatEther(pending)} · undistributed ${poolPending} wei · held ${formatEther(held)}`,
  );
  return { donated, pending, poolPending, held };
}

const before = await state("before");

const amount = parseEther("0.001");
console.log(`\ndonating ${formatEther(amount)} ETH…`);
const donateHash = await wallet.writeContract({
  ...contract,
  functionName: "donate",
  args: ["for the mappers of London"],
  value: amount,
  chain: wallet.chain,
  account: wallet.account!,
});
await publicClient.waitForTransactionReceipt({ hash: donateHash });
console.log(`  ${explorerTxUrl(donateHash)}`);
await readAfter("totalDonated", undefined, before.donated);

const donated = await state("after donate");
const accrued = donated.pending - before.pending;
const carried = donated.poolPending - before.poolPending;

if (accrued + carried !== amount) {
  console.error(`\nFAIL: ${accrued} claimable + ${carried} carried != ${amount} donated`);
  process.exit(1);
}
console.log(`  ✓ every wei accounted for: ${accrued} claimable, ${carried} carried forward`);

console.log("\nclaiming…");
const claimHash = await wallet.writeContract({
  ...contract, functionName: "claim", chain: wallet.chain, account: wallet.account!,
});
const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimHash });
const gas = claimReceipt.gasUsed * claimReceipt.effectiveGasPrice;
console.log(`  ${explorerTxUrl(claimHash)}`);
await readAfter("pendingOf", [me], donated.pending);

const after = await state("after claim");
// Taken from the Claimed event rather than a balance difference: a balance read taken
// around a transaction can come from either side of it on this RPC, and the discrepancy
// then looks exactly like a contract bug.
const claimedLog = claimReceipt.logs
  .map((entry) => {
    try {
      return decodeEventLog({ abi: wwwcAbi, data: entry.data, topics: entry.topics });
    } catch {
      return null;
    }
  })
  .find((entry) => entry?.eventName === "Claimed");

if (!claimedLog) {
  console.error("FAIL: no Claimed event in the receipt");
  process.exit(1);
}
const received = (claimedLog.args as { amount: bigint }).amount;

console.log(`\nreceived ${received} wei (gas ${formatEther(gas)} ETH)`);
if (received !== donated.pending) {
  console.error(`FAIL: expected to receive ${donated.pending} wei`);
  process.exit(1);
}
if (after.pending !== 0n) {
  console.error(`FAIL: ${after.pending} wei still claimable after claiming`);
  process.exit(1);
}
if (after.held !== after.poolPending) {
  console.error(`FAIL: contract holds ${after.held} but only ${after.poolPending} is unallocated`);
  process.exit(1);
}
console.log("✓ donate → accrue → claim works onchain, and the contract holds only the carry");
