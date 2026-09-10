/**
 * Replays contributions from an older deployment onto the current contract.
 *
 * Redeploying the contract used to orphan everything anyone had submitted to the previous
 * one — it cost a real contributor their entry twice before this existed. A redeploy is no
 * longer destructive: point this at the old subgraph and it re-logs whatever is missing,
 * crediting each entry to its original contributor and keeping its provenance.
 *
 *   npx tsx scripts/migrate.mts --from https://api.studio.thegraph.com/query/.../v0.0.5
 *   npx tsx scripts/migrate.mts --from <url> --dry-run
 *
 * Entries are matched on contributor + coordinates, so running it twice is safe.
 */
import "dotenv/config";
import { contractAddress, explorerTxUrl, toChainCoord } from "../lib/chain";
import { encodePayload, type Toilet } from "../lib/payload";
import { publicClient, relayerClient } from "../lib/relayer";
import { readUntilAtLeast } from "../lib/rpc";
import { fetchToilets, query, subgraphUrl } from "../lib/subgraph";
import { wwwcAbi } from "../lib/wwwc-abi";

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const from = arg("from");
const dryRun = process.argv.includes("--dry-run");
if (!from) throw new Error("--from <old subgraph url> is required");
if (from === subgraphUrl) throw new Error("--from is the current subgraph; nothing to migrate");

type Old = {
  name: string; building: string; lat: string; lng: string;
  access: string; price: number; currency: string;
  cleanliness: number; smell: number; busyness: number;
  hasPaper: string; hasBidet: string; isStaffed: string;
  isAccessible: string; hasChangingTable: string; hasMusic: string;
  openingHours: string; style: string; photoUrl: string;
  source: string; sourceUrl: string; contributor: { id: string };
};

const response = await fetch(from, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: `{
      toilets(first: 1000, orderBy: createdAt) {
        name building lat lng access price currency
        cleanliness smell busyness
        hasPaper hasBidet isStaffed isAccessible hasChangingTable hasMusic
        openingHours style photoUrl source sourceUrl contributor { id }
      }
    }`,
  }),
});
const body = (await response.json()) as { data?: { toilets: Old[] }; errors?: unknown };
if (!body.data) throw new Error(`old subgraph error: ${JSON.stringify(body.errors)}`);

// Older versions stored these as booleans; newer ones as YES/NO/UNKNOWN. Accept both.
const known = (value: unknown): boolean | undefined => {
  if (value === true || value === "YES") return true;
  if (value === false || value === "NO") return false;
  return undefined;
};

const current = await fetchToilets();
const seen = new Set(
  current.map((t) => `${t.contributor.toLowerCase()}@${t.lat.toFixed(5)},${t.lng.toFixed(5)}`),
);

const missing = body.data.toilets.filter((old) => {
  const key = `${old.contributor.id.toLowerCase()}@${Number(old.lat).toFixed(5)},${Number(old.lng).toFixed(5)}`;
  return !seen.has(key);
});

console.log(`old deployment: ${body.data.toilets.length} toilets`);
console.log(`current:        ${current.length}`);
console.log(`to migrate:     ${missing.length}\n`);

if (missing.length === 0) {
  console.log("nothing to do");
  process.exit(0);
}

for (const old of missing) {
  console.log(
    `  ${(old.name || "(unnamed)").padEnd(28)} ${old.source.padEnd(6)} ${old.contributor.id.slice(0, 10)}…` +
      `${old.photoUrl ? " 📷" : ""}`,
  );
}
if (dryRun) {
  console.log("\n--dry-run, nothing written");
  process.exit(0);
}

const wallet = relayerClient();
const before = (await publicClient.readContract({
  address: contractAddress, abi: wwwcAbi, functionName: "toiletCount",
})) as bigint;

let nonce = await publicClient.getTransactionCount({ address: wallet.account!.address });
let migrated = 0;
let lastHash: `0x${string}` | null = null;

for (const old of missing) {
  const toilet: Partial<Toilet> = {
    name: old.name,
    building: old.building,
    access: old.access as Toilet["access"],
    price: old.price,
    currency: old.currency,
    cleanliness: old.cleanliness,
    smell: old.smell,
    busyness: old.busyness,
    hasPaper: known(old.hasPaper),
    hasBidet: known(old.hasBidet),
    isStaffed: known(old.isStaffed),
    isAccessible: known(old.isAccessible),
    hasChangingTable: known(old.hasChangingTable),
    hasMusic: known(old.hasMusic),
    openingHours: old.openingHours,
    style: old.style,
    photoUrl: old.photoUrl,
    source: old.source as Toilet["source"],
    sourceUrl: old.sourceUrl,
  };

  try {
    lastHash = await wallet.writeContract({
      address: contractAddress,
      abi: wwwcAbi,
      functionName: "logFor",
      args: [
        old.contributor.id as `0x${string}`,
        toChainCoord(Number(old.lat)),
        toChainCoord(Number(old.lng)),
        encodePayload(toilet),
        old.source === "agent",
      ],
      chain: wallet.chain,
      account: wallet.account!,
      nonce: nonce++,
    });
    migrated++;
    console.log(`  ✓ ${old.name || "(unnamed)"} → ${explorerTxUrl(lastHash)}`);
  } catch (error) {
    console.error(`  ✗ ${old.name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    nonce = await publicClient.getTransactionCount({ address: wallet.account!.address });
  }
}

if (lastHash) await publicClient.waitForTransactionReceipt({ hash: lastHash });
const after = await readUntilAtLeast(
  () => publicClient.readContract({
    address: contractAddress, abi: wwwcAbi, functionName: "toiletCount",
  }) as Promise<bigint>,
  before + BigInt(migrated),
  "toiletCount",
);
console.log(`\nmigrated ${migrated}; contract now holds ${after} toilets`);
