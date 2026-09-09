/**
 * Puts the harvested toilets onchain as agent-sourced entries.
 *
 *   npm run seed -- --city london --limit 120
 *
 * Resumable: every submitted OSM id is recorded, so a re-run adds only what's missing
 * rather than duplicating a city. Transactions are sent with explicit nonces so 120 of
 * them don't collide racing for the same one.
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { formatEther } from "viem";
import { contractAddress, toChainCoord } from "../lib/chain";
import { encodePayload, type Toilet } from "../lib/payload";
import { publicClient, relayerClient } from "../lib/relayer";
import { wwwcAbi } from "../lib/wwwc-abi";

type HarvestedToilet = {
  lat: number;
  lng: number;
  osmType: string;
  osmId: number;
  toilet: Partial<Toilet>;
};

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const city = arg("city", "london").toLowerCase();
const limit = Number(arg("limit", "120"));

const harvested = JSON.parse(readFileSync(`data/seed-${city}.json`, "utf8")) as HarvestedToilet[];
const ledgerPath = `data/submitted-${city}.json`;
const submitted: Record<string, string> = existsSync(ledgerPath)
  ? (JSON.parse(readFileSync(ledgerPath, "utf8")) as Record<string, string>)
  : {};

const pending = harvested
  .filter((entry) => !submitted[`${entry.osmType}/${entry.osmId}`])
  .slice(0, limit);

const wallet = relayerClient();
const account = wallet.account!;
const balanceBefore = await publicClient.getBalance({ address: account.address });
const countBefore = (await publicClient.readContract({
  address: contractAddress,
  abi: wwwcAbi,
  functionName: "toiletCount",
})) as bigint;

console.log(`${harvested.length} harvested, ${Object.keys(submitted).length} already onchain`);
console.log(`submitting ${pending.length} as agent entries`);
console.log(`relayer ${account.address} — ${formatEther(balanceBefore)} ETH\n`);

if (pending.length === 0) {
  console.log("nothing to do");
  process.exit(0);
}

let nonce = await publicClient.getTransactionCount({ address: account.address });
let lastHash: `0x${string}` | null = null;
let failures = 0;

for (const [index, entry] of pending.entries()) {
  const key = `${entry.osmType}/${entry.osmId}`;
  try {
    const hash = await wallet.writeContract({
      address: contractAddress,
      abi: wwwcAbi,
      functionName: "logFor",
      args: [
        account.address,
        toChainCoord(entry.lat),
        toChainCoord(entry.lng),
        encodePayload({ ...entry.toilet, source: "agent" }),
        true,
      ],
      chain: wallet.chain,
      account,
      nonce: nonce++,
    });

    submitted[key] = hash;
    lastHash = hash;
    const label = entry.toilet.name || "(unnamed)";
    console.log(`  ${String(index + 1).padStart(3)}/${pending.length}  ${label.slice(0, 44)}`);
  } catch (error) {
    failures++;
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`  ${String(index + 1).padStart(3)}/${pending.length}  FAILED ${key}: ${message}`);
    // Our nonce assumption is broken once a send fails; resync rather than burn the rest.
    nonce = await publicClient.getTransactionCount({ address: account.address });
    if (failures > 5) {
      console.error("too many failures, stopping");
      break;
    }
  }
}

writeFileSync(ledgerPath, `${JSON.stringify(submitted, null, 2)}\n`);

if (lastHash) {
  console.log("\nwaiting for the last transaction to confirm…");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: lastHash });
  console.log(`last tx ${receipt.status} in block ${receipt.blockNumber}`);
}

const readCount = () =>
  publicClient.readContract({ address: contractAddress, abi: wwwcAbi, functionName: "toiletCount" });

// Immediately after a receipt the public RPC will still serve an older block — an earlier
// run reported three toilets when six were onchain. Pinning the read to the receipt's
// block doesn't work either: sepolia.base.org is not an archive node and answers
// "block not found". So poll the latest until it catches up.
const expected = countBefore + BigInt(pending.length - failures);
let onchain = await readCount();
for (let attempt = 0; onchain < expected && attempt < 15; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  onchain = await readCount();
}

const spent = balanceBefore - (await publicClient.getBalance({ address: account.address }));

console.log(`\n${onchain} toilets onchain · ${formatEther(spent)} ETH of gas · ${failures} failures`);
console.log(`ledger written to ${ledgerPath}`);
