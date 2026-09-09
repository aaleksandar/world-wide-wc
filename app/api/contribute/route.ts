import { NextResponse } from "next/server";
import { verifyTypedData } from "viem";
import { toChainCoord } from "@/lib/chain";
import {
  CONTRIBUTION_DOMAIN,
  CONTRIBUTION_TYPES,
  SIGNATURE_TTL_SECONDS,
  type ContributeRequest,
} from "@/lib/contribution";
import { encodePayload } from "@/lib/payload";
import { rateLimit } from "@/lib/rate-limit";
import { publicClient, relayToiletLog } from "@/lib/relayer";

/**
 * Takes a signed contribution and puts it onchain at our expense.
 *
 * Open to people and to third-party agents alike — the map is meant to be fed by both,
 * and an agent is just a contributor with a source URL instead of a pair of eyes. The
 * signature is what makes the entry theirs: they are the address the contract credits and
 * rewards accrue to. We only pay the gas.
 *
 * Agents that would rather not depend on us can skip this endpoint entirely and call
 * `log(lat, lng, payload, true)` on the contract themselves. See SKILL.md.
 */

// Per minute, per address. The relayer's wallet is the thing being spent here.
const MAX_PER_ADDRESS = 30;

export async function POST(request: Request) {
  let body: ContributeRequest;
  try {
    body = (await request.json()) as ContributeRequest;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { contributor, lat, lng, toilet, signedAt, signature } = body;
  const isAgent = body.source === "agent";

  if (!contributor || !signature || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json(
      { error: "contributor, lat, lng and signature are required" },
      { status: 400 },
    );
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Coordinates are off the planet" }, { status: 400 });
  }

  // An agent-sourced entry without a source is worthless: nobody can check it, and
  // checkability is the only thing it has instead of somebody having been there.
  if (isAgent && !toilet?.sourceUrl?.trim()) {
    return NextResponse.json(
      { error: "Agent contributions must include toilet.sourceUrl saying where the data came from" },
      { status: 400 },
    );
  }
  if (toilet?.sourceUrl && !/^https?:\/\//i.test(toilet.sourceUrl)) {
    return NextResponse.json({ error: "sourceUrl must be http(s)" }, { status: 400 });
  }

  const age = Math.floor(Date.now() / 1000) - signedAt;
  if (!Number.isFinite(age) || age < -60 || age > SIGNATURE_TTL_SECONDS) {
    return NextResponse.json({ error: "Signature has expired — please sign again" }, { status: 400 });
  }

  const limit = rateLimit(contributor.toLowerCase(), MAX_PER_ADDRESS);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error:
          `Too many relayed contributions from this address. Retry in ${limit.retryAfter}s, ` +
          "or call the contract directly and pay your own gas — see SKILL.md.",
      },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const payload = encodePayload({ ...toilet, source: isAgent ? "agent" : "human" });
  const chainLat = toChainCoord(lat);
  const chainLng = toChainCoord(lng);

  const valid = await verifyTypedData({
    address: contributor,
    domain: CONTRIBUTION_DOMAIN,
    types: CONTRIBUTION_TYPES,
    primaryType: "Contribution",
    message: { contributor, lat: chainLat, lng: chainLng, payload, signedAt: BigInt(signedAt) },
    signature,
  });

  if (!valid) {
    return NextResponse.json({ error: "Signature does not match contributor" }, { status: 401 });
  }

  try {
    const hash = await relayToiletLog({
      contributor,
      lat: chainLat,
      lng: chainLng,
      payload,
      isAgent,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction reverted", hash }, { status: 502 });
    }
    return NextResponse.json({
      hash,
      blockNumber: Number(receipt.blockNumber),
      source: isAgent ? "agent" : "human",
      weight: isAgent ? 3 : 10,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relay failed";
    const outOfFunds = /insufficient funds/i.test(message);
    return NextResponse.json(
      {
        error: outOfFunds
          ? "The relayer wallet is out of Base Sepolia ETH — top it up and try again."
          : message,
      },
      { status: 502 },
    );
  }
}
