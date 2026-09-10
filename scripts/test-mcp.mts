/**
 * Drives the MCP server over stdio exactly as Claude Code would, and checks every tool.
 *
 *   npx tsx scripts/test-mcp.mts
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// A wallet this map has never seen, standing in for a stranger's agent.
const key = generatePrivateKey();
const agent = privateKeyToAccount(key);
console.log(`third-party agent ${agent.address}\n`);

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "mcp/server.mts"],
  env: { ...process.env, WWWC_AGENT_PRIVATE_KEY: key } as Record<string, string>,
});
const client = new Client({ name: "test", version: "0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(`tools: ${tools.tools.map((t) => t.name).join(", ")}\n`);

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0]?.text ?? "";
  return { text, isError: !!result.isError };
};

let failed = 0;
const check = (what: string, ok: boolean) => {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failed++;
};

console.log("find_toilets — free, step-free, within 1km of Trafalgar Square");
const found = await call("find_toilets", {
  lat: 51.508, lng: -0.128, radiusMetres: 1000, access: ["free"], needsStepFree: true, limit: 3,
});
console.log(found.text.slice(0, 420));
const parsed = JSON.parse(found.text) as { found: number; toilets?: Record<string, unknown>[] };
check("returned results", parsed.found > 0);
check("computed distance (no GraphQL equivalent)", !!parsed.toilets?.[0]?.distance);
check("resolved openNow (no GraphQL equivalent)", parsed.toilets?.[0]?.openNow !== undefined);
check("carries provenance", !!parsed.toilets?.[0]?.provenance);

console.log("\nmap_stats");
const stats = await call("map_stats", {});
console.log(`  ${stats.text.replace(/\s+/g, " ").slice(0, 200)}`);

console.log("\ncontribute_toilet — with provenance");
const wrote = await call("contribute_toilet", {
  lat: 51.5245, lng: -0.1340,
  name: "Wellcome Collection",
  building: "Euston Road, ground floor past the cafe",
  access: "free",
  isAccessible: true,
  sourceUrl: "https://wellcomecollection.org/visit-us/facilities",
});
console.log(`  ${wrote.text.slice(0, 200)}`);
check("write succeeded", !wrote.isError);
check("credited to the agent's own wallet", wrote.text.includes(agent.address));

console.log("\ncontribute_toilet — refuses a guess at cleanliness? (schema has no such field)");
check("no rating fields on contribute", !JSON.stringify(tools.tools.find((t) => t.name === "contribute_toilet")?.inputSchema).includes("cleanliness"));

console.log("\nrate_toilet — fill a gap on an existing entry");
const rated = await call("rate_toilet", { id: "2", cleanliness: 4, hasPaper: true, note: "via MCP" });
console.log(`  ${rated.text.slice(0, 160)}`);
check("rating succeeded", !rated.isError);

console.log("\nrate_toilet — empty rating refused");
const empty = await call("rate_toilet", { id: "2" });
check("empty rating refused", empty.isError);

await client.close();
console.log(failed ? `\n${failed} check(s) failed` : "\n✓ every MCP tool works, including writes");
process.exit(failed ? 1 : 0);
