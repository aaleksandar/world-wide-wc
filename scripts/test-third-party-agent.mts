/**
 * Pretends to be somebody else's agent and contributes to the map two ways:
 *   1. relayed  — sign, POST to /api/contribute, we pay the gas
 *   2. direct   — call log() on the contract, the agent pays its own gas
 *
 * The second path is the one that matters: it needs nothing of ours except the contract
 * address, so the map survives us.
 *
 *   npx tsx scripts/test-third-party-agent.mts
 */
import "dotenv/config";
import { createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { chain, contractAddress, explorerTxUrl, rpcUrl, toChainCoord } from "../lib/chain";
import { CONTRIBUTION_DOMAIN, CONTRIBUTION_TYPES } from "../lib/contribution";
import { encodePayload } from "../lib/payload";
import { publicClient, relayerClient } from "../lib/relayer";
import { readUntil, readUntilAtLeast } from "../lib/rpc";
import { wwwcAbi } from "../lib/wwwc-abi";

const APP = process.env.APP_URL ?? "http://localhost:3000";

// A wallet we have never seen before, standing in for a stranger's agent.
const agent = privateKeyToAccount(generatePrivateKey());
const agentWallet = createWalletClient({ account: agent, chain, transport: http(rpcUrl) });
console.log(`third-party agent ${agent.address}\n`);

const entry = {
  lat: 51.5194,
  lng: -0.127,
  toilet: {
    name: "British Museum",
    building: "Great Court, near the north stairs",
    access: "free" as const,
    isAccessible: true,
    hasChangingTable: true,
    openingHours: "Mo-Su 10:00-17:00",
    sourceUrl: "https://www.britishmuseum.org/visit/facilities",
  },
};

// --- 1. relayed --------------------------------------------------------------
console.log("relayed path:");
const payload = encodePayload({ ...entry.toilet, source: "agent" });
const signedAt = Math.floor(Date.now() / 1000);
const signature = await agentWallet.signTypedData({
  account: agent,
  domain: CONTRIBUTION_DOMAIN,
  types: CONTRIBUTION_TYPES,
  primaryType: "Contribution",
  message: {
    contributor: agent.address,
    lat: toChainCoord(entry.lat),
    lng: toChainCoord(entry.lng),
    payload,
    signedAt: BigInt(signedAt),
  },
});

const response = await fetch(`${APP}/api/contribute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    contributor: agent.address, ...entry, source: "agent", signedAt, signature,
  }),
});
const result = (await response.json()) as Record<string, unknown>;
if (!response.ok) {
  console.error(`  FAILED ${response.status}: ${result.error}`);
  process.exit(1);
}
console.log(`  ${explorerTxUrl(result.hash as string)}`);
console.log(`  credited as ${result.source}, weight ${result.weight}`);
if (result.source !== "agent" || result.weight !== 3) {
  console.error("  FAIL: should have been credited as an agent at weight 3");
  process.exit(1);
}

// It must refuse an agent entry with no provenance.
const noSource = await fetch(`${APP}/api/contribute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    contributor: agent.address, ...entry,
    toilet: { ...entry.toilet, sourceUrl: "" },
    source: "agent", signedAt, signature,
  }),
});
console.log(`  without a sourceUrl: ${noSource.status} ${((await noSource.json()) as { error: string }).error}`);
if (noSource.status !== 400) {
  console.error("  FAIL: should have refused an agent entry with no provenance");
  process.exit(1);
}

// --- 2. direct ---------------------------------------------------------------
console.log("\ndirect path (agent pays its own gas):");
const relayer = relayerClient();

// Give the stranger's agent a little gas, as a faucet would.
const fundHash = await relayer.sendTransaction({
  account: relayer.account!, chain, to: agent.address, value: parseEther("0.0005"),
});
await publicClient.waitForTransactionReceipt({ hash: fundHash });

await readUntil(
  () => publicClient.getBalance({ address: agent.address }),
  (balance) => balance > 0n,
  { label: "agent balance" },
);
console.log(`  funded with 0.0005 ETH`);

const directHash = await agentWallet.writeContract({
  address: contractAddress,
  abi: wwwcAbi,
  functionName: "log",
  args: [
    toChainCoord(51.5033),
    toChainCoord(-0.1195),
    encodePayload({
      name: "Southbank Centre",
      building: "Royal Festival Hall, level 2",
      access: "free",
      isAccessible: true,
      source: "agent",
      sourceUrl: "https://www.southbankcentre.co.uk/visit/accessibility",
    }),
    true,
  ],
  chain,
  account: agent,
});
const directReceipt = await publicClient.waitForTransactionReceipt({ hash: directHash });
console.log(`  ${explorerTxUrl(directHash)} — ${directReceipt.status}`);

const weight = await readUntilAtLeast(
  () =>
    publicClient.readContract({
      address: contractAddress, abi: wwwcAbi, functionName: "weightOf", args: [agent.address],
    }) as Promise<bigint>,
  6n,
  "agent weight",
);
console.log(`\nagent weight onchain: ${weight} (3 relayed + 3 direct)`);
if (weight !== 6n) {
  console.error("FAIL: expected weight 6");
  process.exit(1);
}
console.log("✓ a stranger's agent can contribute, with or without our server");
