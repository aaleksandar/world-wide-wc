/**
 * Drives a verdict onto the live contract and checks it lands, is indexed, and pays the
 * right weight to the right person. No model — a hand-written score stands in for the
 * judge so the money path can be tested independently of it.
 *
 *   npx tsx scripts/test-verify.mts
 */
import "dotenv/config";
import { contractAddress, explorerTxUrl } from "../lib/chain";
import { publicClient, relayerClient } from "../lib/relayer";
import { readUntil } from "../lib/rpc";
import { query } from "../lib/subgraph";
import { wwwcAbi } from "../lib/wwwc-abi";

type T = {
  id: string; name: string; source: string; verificationScore: number;
  verificationBand: string; verificationEvidence: string; weightBonus: number;
  contributor: { id: string; weight: string };
};

const pick = await query<{ toilets: T[] }>(
  `{ toilets(where: { source: "agent", verificationBand: "unchecked" }, first: 1) {
      id name source verificationScore verificationBand verificationEvidence weightBonus
      contributor { id weight }
  } }`,
);
const target = pick.toilets[0];
if (!target) throw new Error("no unchecked agent entry to verify");

const contributor = target.contributor.id as `0x${string}`;
const weightBefore = BigInt(target.contributor.weight);
console.log(`before: #${target.id} ${target.name || "(unnamed)"} — ${target.verificationBand}`);
console.log(`        contributor ${contributor} weight ${weightBefore}\n`);

const wallet = relayerClient();
const evidence = "source surveyed 174 days ago; access, price and step-free all corroborated";
const hash = await wallet.writeContract({
  address: contractAddress, abi: wwwcAbi, functionName: "verify",
  args: [BigInt(target.id), 92, evidence],
  chain: wallet.chain, account: wallet.account!,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`verified: ${explorerTxUrl(hash)} — ${receipt.status}`);

const after = await readUntil(
  () =>
    query<{ toilet: T; global: { verifiedCount: number } }>(
      `query($id: ID!) {
        toilet(id: $id) {
          id name source verificationScore verificationBand verificationEvidence weightBonus
          contributor { id weight }
        }
        global(id: "global") { verifiedCount }
      }`,
      { id: target.id },
    ).catch(() => ({ toilet: target, global: { verifiedCount: 0 } })),
  (d) => d.toilet.verificationBand !== "unchecked",
  { label: "verdict indexed" },
);

const t = after.toilet;
console.log(`\nafter:  band ${t.verificationBand} (${t.verificationScore}) bonus +${t.weightBonus}`);
console.log(`        "${t.verificationEvidence}"`);
console.log(`        contributor weight ${t.contributor.weight}, verified onchain ${after.global.verifiedCount}`);

const onchainWeight = (await publicClient.readContract({
  address: contractAddress, abi: wwwcAbi, functionName: "weightOf", args: [contributor],
})) as bigint;

const checks: [string, boolean][] = [
  ["band is max", t.verificationBand === "max"],
  ["bonus is 7", t.weightBonus === 7],
  ["evidence stored onchain and indexed", t.verificationEvidence === evidence],
  ["contributor gained exactly 7 weight", BigInt(t.contributor.weight) === weightBefore + 7n],
  ["subgraph weight matches the chain", BigInt(t.contributor.weight) === onchainWeight],
  ["global verified count moved", after.global.verifiedCount >= 1],
];

let failed = 0;
console.log();
for (const [what, ok] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log("\n✓ a verdict pays real weight, to the right person, and the subgraph agrees");
