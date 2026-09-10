/**
 * The trust agent: reads live entries from the subgraph, checks the source behind each
 * one, and writes a verdict onchain that pays the contributor the weight it earns.
 *
 *   npx tsx scripts/judge.mts --dry-run          # reason, print, write nothing
 *   npx tsx scripts/judge.mts --limit 20
 *   npx tsx scripts/judge.mts --recheck 90       # also re-judge verdicts older than 90 days
 *
 * This is the loop the whole project is arguing for: an agent reading data from The Graph,
 * forming a judgement about how much it can be trusted, and having that judgement change
 * who gets paid.
 */
import "dotenv/config";
import { contractAddress, explorerTxUrl } from "../lib/chain";
import { gatherEvidence } from "../lib/evidence";
import { judge } from "../lib/judge";
import { publicClient, relayerClient } from "../lib/relayer";
import { query, type ToiletRecord } from "../lib/subgraph";
import { wwwcAbi } from "../lib/wwwc-abi";

const arg = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};
const dryRun = process.argv.includes("--dry-run");
const limit = Number(arg("limit", "10"));
const recheckDays = Number(arg("recheck", "0"));

const DAY = 86_400;
const cutoff = recheckDays ? Math.floor(Date.now() / 1000) - recheckDays * DAY : 0;

const { toilets } = await query<{ toilets: (ToiletRecord & { verifiedAt: string | null })[] }>(
  `query($first: Int!) {
    toilets(first: $first, orderBy: createdAt, orderDirection: asc) {
      id name building lat lng access price currency openingHours style photoUrl
      cleanliness smell busyness avgCleanliness avgSmell avgBusyness ratingCount
      hasPaper hasBidet isStaffed isAccessible hasChangingTable hasMusic
      source sourceUrl txHash createdAt
      verificationScore verificationBand verificationEvidence weightBonus verifiedAt
      contributor { id }
    }
  }`,
  { first: 1000 },
);

const needsJudging = toilets
  .map((raw) => ({ ...raw, contributor: (raw.contributor as unknown as { id: string }).id }))
  .filter((toilet) => {
    if (!toilet.sourceUrl) return false; // nothing to check
    if (toilet.verificationBand === "unchecked") return true;
    return cutoff > 0 && Number(toilet.verifiedAt ?? 0) < cutoff;
  })
  .slice(0, limit);

console.log(`${toilets.length} entries indexed · ${needsJudging.length} to judge${dryRun ? " (dry run)" : ""}\n`);
if (needsJudging.length === 0) process.exit(0);

const wallet = dryRun ? null : relayerClient();
let nonce = wallet ? await publicClient.getTransactionCount({ address: wallet.account!.address }) : 0;

const tally: Record<string, number> = { max: 0, medium: 0, low: 0, failed: 0 };
let lastHash: `0x${string}` | null = null;

for (const [index, toilet] of needsJudging.entries()) {
  const label = `${String(index + 1).padStart(3)}/${needsJudging.length} #${toilet.id} ${(toilet.name || "(unnamed)").slice(0, 26).padEnd(26)}`;

  const evidence = await gatherEvidence(toilet as unknown as ToiletRecord);
  const verdict = await judge(evidence);

  if ("error" in verdict) {
    tally.failed++;
    console.log(`${label} ✗ ${verdict.error}`);
    continue;
  }

  tally[verdict.band]++;
  const bonus = verdict.band === "max" ? "+7" : verdict.band === "medium" ? "+2" : " 0";
  console.log(`${label} ${verdict.band.padEnd(6)} ${String(verdict.score).padStart(3)} ${bonus}  ${verdict.reasoning.slice(0, 88)}`);

  if (dryRun || !wallet) continue;

  try {
    lastHash = await wallet.writeContract({
      address: contractAddress,
      abi: wwwcAbi,
      functionName: "verify",
      args: [BigInt(toilet.id), verdict.score, verdict.reasoning],
      chain: wallet.chain,
      account: wallet.account!,
      nonce: nonce++,
    });
  } catch (error) {
    console.error(`      ✗ onchain: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    nonce = await publicClient.getTransactionCount({ address: wallet.account!.address });
  }
}

if (lastHash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: lastHash });
  console.log(`\nlast verdict ${receipt.status} — ${explorerTxUrl(lastHash)}`);
}

console.log(
  `\nmax ${tally.max} · medium ${tally.medium} · low ${tally.low}` +
    (tally.failed ? ` · ${tally.failed} failed` : "") +
    (dryRun ? "\nnothing written — drop --dry-run to record these onchain" : ""),
);
