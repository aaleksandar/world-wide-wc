/**
 * Says whether AI_GATEWAY_API_KEY actually works, so a bad key looks like a bad key
 * rather than a broken feature.
 *
 *   npx tsx scripts/check-ai-key.mts
 */
import "dotenv/config";

const key = process.env.AI_GATEWAY_API_KEY;
if (!key) {
  console.error("AI_GATEWAY_API_KEY is not set");
  process.exit(1);
}

const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
  headers: { authorization: `Bearer ${key}` },
});

if (response.ok) {
  const body = (await response.json()) as { data: { id: string }[] };
  console.log(`key works — ${body.data.length} models available`);
  process.exit(0);
}

console.error(`key rejected: HTTP ${response.status}`);
console.error((await response.text()).slice(0, 300));
console.error(
  "\nVercel AI Gateway keys start with `vck_`. Create one at" +
    " https://vercel.com/[team]/~/ai-gateway/api-keys",
);
process.exit(1);
