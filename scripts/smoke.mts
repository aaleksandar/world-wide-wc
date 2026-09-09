/**
 * End-to-end proof that the loop closes: write onchain, then read it back out of The
 * Graph. If this passes, the app's only read path is genuinely serving live chain data.
 *
 *   npm run smoke
 */
import "dotenv/config";
import { formatEther } from "viem";
import { contractAddress, explorerTxUrl, toChainCoord } from "../lib/chain";
import { encodePayload } from "../lib/payload";
import { publicClient, relayToiletLog, relayerClient } from "../lib/relayer";
import { query } from "../lib/subgraph";
import { wwwcAbi } from "../lib/wwwc-abi";

const wallet = relayerClient();
console.log(`contract ${contractAddress}`);
console.log(`relayer  ${wallet.account!.address}`);
console.log(
  `balance  ${formatEther(await publicClient.getBalance({ address: wallet.account!.address }))} ETH\n`,
);

const before = await publicClient.readContract({
  address: contractAddress,
  abi: wwwcAbi,
  functionName: "toiletCount",
});

// The Attendant, Fitzrovia: a Victorian gents' toilet that is now a coffee shop. Real
// place, and a fitting first entry.
const payload = encodePayload({
  name: "The Attendant",
  building: "Fitzrovia — down the stairs, former Victorian gents",
  access: "customer",
  cleanliness: 5,
  smell: 4,
  hasPaper: true,
  style: "Victorian urinals turned into coffee bar seating",
  source: "human",
  sourceUrl: "https://the-attendant.com/",
});

const hash = await relayToiletLog({
  contributor: wallet.account!.address,
  lat: toChainCoord(51.5183),
  lng: toChainCoord(-0.1385),
  payload,
  isAgent: false,
});
console.log(`logged  ${explorerTxUrl(hash)}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`status  ${receipt.status} in block ${receipt.blockNumber}`);
if (receipt.status !== "success") process.exit(1);

const expectedId = (before as bigint) + 1n;
console.log(`\nwaiting for the subgraph to index toilet ${expectedId}…`);

const deadline = Date.now() + 180_000;
for (let attempt = 1; Date.now() < deadline; attempt++) {
  const data = await query<{ toilet: Record<string, unknown> | null }>(
    `query($id: ID!) {
      toilet(id: $id) {
        id name building access cleanliness hasPaper style source sourceUrl
        lat lng txHash contributor { id weight toiletsLogged }
      }
    }`,
    { id: expectedId.toString() },
  ).catch((error: Error) => {
    console.log(`  attempt ${attempt}: ${error.message}`);
    return { toilet: null };
  });

  if (data.toilet) {
    console.log("\nindexed:");
    console.log(JSON.stringify(data.toilet, null, 2));
    console.log("\nchain → subgraph → app. The loop closes.");
    process.exit(0);
  }
  console.log(`  attempt ${attempt}: not indexed yet`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

console.error("\nsubgraph did not index within 3 minutes");
process.exit(1);
