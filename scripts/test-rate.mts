/**
 * A stranger walks into a toilet an agent found and fills in what it could not know.
 *
 *   npx tsx scripts/test-rate.mts
 *
 * Asserts the gap actually closes: an UNKNOWN amenity becomes a definite answer, the
 * scales start averaging, and the rater earns their weight.
 */
import "dotenv/config";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { chain, explorerTxUrl, rpcUrl } from "../lib/chain";
import { CONTRIBUTION_DOMAIN, RATING_TYPES } from "../lib/contribution";
import { encodeRatingPayload } from "../lib/payload";
import { readUntil } from "../lib/rpc";
import { query } from "../lib/subgraph";

const APP = process.env.APP_URL ?? "http://localhost:3000";

type T = {
  id: string; name: string; hasPaper: string; hasBidet: string; hasMusic: string;
  avgCleanliness: string; avgSmell: string; ratingCount: number; style: string;
};

const pick = await query<{ toilets: T[] }>(
  `{ toilets(where: { source: "agent", hasPaper: UNKNOWN }, first: 1) {
      id name hasPaper hasBidet hasMusic avgCleanliness avgSmell ratingCount style
  } }`,
);
const target = pick.toilets[0];
if (!target) throw new Error("no agent-sourced toilet with an unknown paper state");

console.log(`before: #${target.id} ${target.name || "(unnamed)"}`);
console.log(`  paper ${target.hasPaper} · bidet ${target.hasBidet} · music ${target.hasMusic}`);
console.log(`  cleanliness ${target.avgCleanliness} · ${target.ratingCount} ratings\n`);

const visitor = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ account: visitor, chain, transport: http(rpcUrl) });
console.log(`visitor ${visitor.address}`);

const observations = {
  cleanliness: 4,
  smell: 3,
  hasPaper: true,
  hasBidet: false,
  note: "Hand dryer is broken but it's clean enough",
};
const payload = encodeRatingPayload(observations);
const signedAt = Math.floor(Date.now() / 1000);

const signature = await wallet.signTypedData({
  account: visitor,
  domain: CONTRIBUTION_DOMAIN,
  types: RATING_TYPES,
  primaryType: "Rating",
  message: { rater: visitor.address, toiletId: BigInt(target.id), payload, signedAt: BigInt(signedAt) },
});

const response = await fetch(`${APP}/api/rate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ rater: visitor.address, toiletId: target.id, observations, signedAt, signature }),
});
const result = (await response.json()) as { hash?: string; error?: string; weight?: number };
if (!response.ok) {
  console.error(`FAILED ${response.status}: ${result.error}`);
  process.exit(1);
}
console.log(`rated: ${explorerTxUrl(result.hash!)}  (weight ${result.weight})\n`);

// An empty rating must be refused rather than burning gas for nothing.
const empty = await fetch(`${APP}/api/rate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ rater: visitor.address, toiletId: target.id, observations: {}, signedAt, signature }),
});
console.log(`empty rating: ${empty.status} ${((await empty.json()) as { error: string }).error}`);
if (empty.status !== 400) {
  console.error("FAIL: an empty rating should be refused");
  process.exit(1);
}

console.log("\nwaiting for the subgraph…");
const after = await readUntil(
  () =>
    query<{ toilet: T; contributors: { id: string; weight: string; ratingsGiven: number }[] }>(
      `query($id: ID!, $who: ID!) {
        toilet(id: $id) { id name hasPaper hasBidet hasMusic avgCleanliness avgSmell ratingCount style }
        contributors(where: { id: $who }) { id weight ratingsGiven }
      }`,
      { id: target.id, who: visitor.address.toLowerCase() },
    ).catch(() => ({ toilet: target, contributors: [] })),
  (d) => d.toilet.ratingCount > target.ratingCount,
  { label: "rating indexed" },
);

const t = after.toilet;
console.log(`\nafter: paper ${t.hasPaper} · bidet ${t.hasBidet} · music ${t.hasMusic}`);
console.log(`  cleanliness ${t.avgCleanliness} · smell ${t.avgSmell} · ${t.ratingCount} ratings`);
console.log(`  character: "${t.style}"`);
console.log(`  rater: weight ${after.contributors[0]?.weight}, ${after.contributors[0]?.ratingsGiven} rating(s)`);

const checks: [string, boolean][] = [
  ["a definite yes filled the paper gap", t.hasPaper === "YES"],
  ["a definite no filled the bidet gap", t.hasBidet === "NO"],
  ["an unmentioned field stayed unknown", t.hasMusic === "UNKNOWN"],
  ["cleanliness now averages", Number(t.avgCleanliness) === 4],
  ["smell now averages", Number(t.avgSmell) === 3],
  ["the note became the character", t.style === observations.note],
  ["the rater earned 1 weight", after.contributors[0]?.weight === "1"],
];

let failed = 0;
console.log();
for (const [what, ok] of checks) {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log("\n✓ a visitor can fill in what an agent could not know");
