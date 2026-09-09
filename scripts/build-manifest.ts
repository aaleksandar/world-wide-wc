/**
 * Renders subgraph.yaml from the template plus .env.
 *
 * The deployed address lives in env rather than in a committed manifest, so pointing the
 * subgraph at a redeployed contract — or at a different network entirely — is a config
 * change and a rebuild, not an edit.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";

const network = process.env.SUBGRAPH_NETWORK ?? "base-sepolia";
const address = process.env.NEXT_PUBLIC_WWWC_ADDRESS;
const startBlock = process.env.NEXT_PUBLIC_WWWC_START_BLOCK;

if (!address || !startBlock) {
  throw new Error(
    "NEXT_PUBLIC_WWWC_ADDRESS and NEXT_PUBLIC_WWWC_START_BLOCK must be set — run `npm run deploy` first",
  );
}

const rendered = readFileSync("subgraph/subgraph.template.yaml", "utf8")
  .replaceAll("{{network}}", network)
  .replaceAll("{{address}}", address)
  .replaceAll("{{startBlock}}", startBlock);

writeFileSync("subgraph/subgraph.yaml", rendered);
console.log(`subgraph.yaml → ${network} ${address} @ ${startBlock}`);
