/**
 * A photo's whole journey: IPFS → onchain → subgraph → back out as fetchable bytes.
 *
 *   npx tsx scripts/test-photo.mts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { contractAddress, explorerTxUrl, toChainCoord } from "../lib/chain";
import { ipfsToHttp } from "../lib/ipfs";
import { decodePayload, encodePayload } from "../lib/payload";
import { publicClient, relayToiletLog } from "../lib/relayer";
import { readUntil } from "../lib/rpc";
import { query } from "../lib/subgraph";
import { wwwcAbi } from "../lib/wwwc-abi";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const imagePath = process.argv[2];
if (!imagePath) throw new Error("usage: test-photo.mts <image>");

const bytes = readFileSync(imagePath);
console.log(`uploading ${imagePath} (${bytes.length} bytes)…`);

const form = new FormData();
form.append("photo", new Blob([bytes], { type: "image/png" }), "toilet.png");
const upload = await fetch(`${APP}/api/photo`, { method: "POST", body: form });
const { url, cid, pinned } = (await upload.json()) as {
  url: string; cid: string; pinned: boolean; error?: string;
};
if (!upload.ok) throw new Error(`upload failed: ${JSON.stringify(url)}`);
console.log(`  ${url}${pinned ? " (pinned remotely)" : ""}`);

const before = (await publicClient.readContract({
  address: contractAddress, abi: wwwcAbi, functionName: "toiletCount",
})) as bigint;

const payload = encodePayload({
  name: "Photo test",
  building: "wherever this ends up",
  access: "free",
  photoUrl: url,
  source: "human",
});

// The URI must survive the round trip through calldata and the mapping unchanged — a
// mangled CID is an unfetchable photo, and it would fail silently.
if (decodePayload(payload).photoUrl !== url) throw new Error("payload codec mangled the URI");

const hash = await relayToiletLog({
  contributor: "0x83e4Ff2CAA34fB79a65A926671Cc142172774d75",
  lat: toChainCoord(51.5145),
  lng: toChainCoord(-0.0755),
  payload,
  isAgent: false,
});
await publicClient.waitForTransactionReceipt({ hash });
console.log(`  ${explorerTxUrl(hash)}`);

const id = (before + 1n).toString();
console.log(`\nwaiting for the subgraph to index toilet ${id}…`);

const indexed = await readUntil(
  () =>
    query<{ toilet: { photoUrl: string; name: string } | null }>(
      `query($id: ID!) { toilet(id: $id) { photoUrl name } }`,
      { id },
    ).catch(() => ({ toilet: null })),
  (data) => data.toilet !== null,
  { label: "subgraph indexing" },
);

const photoUrl = indexed.toilet!.photoUrl;
console.log(`  indexed with photoUrl ${photoUrl}`);
if (photoUrl !== url) {
  console.error(`FAIL: subgraph has ${photoUrl}, expected ${url}`);
  process.exit(1);
}

const gatewayUrl = ipfsToHttp(photoUrl);
console.log(`\nfetching ${gatewayUrl}`);
const fetched = await fetch(gatewayUrl);
const back = Buffer.from(await fetched.arrayBuffer());
console.log(`  ${fetched.status} ${fetched.headers.get("content-type")} ${back.length} bytes`);

if (!back.equals(bytes)) {
  console.error("FAIL: bytes differ from what was uploaded");
  process.exit(1);
}
console.log(`\n✓ photo → IPFS (${cid}) → onchain → subgraph → back, byte-identical`);
