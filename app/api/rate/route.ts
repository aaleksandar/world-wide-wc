import { NextResponse } from "next/server";
import { verifyTypedData } from "viem";
import {
  CONTRIBUTION_DOMAIN,
  RATING_TYPES,
  SIGNATURE_TTL_SECONDS,
} from "@/lib/contribution";
import { encodeRatingPayload, type Toilet } from "@/lib/payload";
import { rateLimit } from "@/lib/rate-limit";
import { publicClient, relayRating } from "@/lib/relayer";

/**
 * Fills in what somebody learned by standing in a toilet that was already on the map.
 *
 * This is the other half of the contribution loop and the more valuable one: an agent can
 * establish that a toilet exists, but only a person can say whether there is paper in it
 * today. Rating earns less weight than logging because the hard part — finding the place —
 * was already done.
 */

const MAX_PER_ADDRESS = 30;

export type RateRequest = {
  rater: `0x${string}`;
  toiletId: string;
  observations: Partial<Toilet> & { note?: string };
  signedAt: number;
  signature: `0x${string}`;
};

export async function POST(request: Request) {
  let body: RateRequest;
  try {
    body = (await request.json()) as RateRequest;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { rater, toiletId, observations, signedAt, signature } = body;
  if (!rater || !signature || !toiletId) {
    return NextResponse.json(
      { error: "rater, toiletId and signature are required" },
      { status: 400 },
    );
  }

  let id: bigint;
  try {
    id = BigInt(toiletId);
  } catch {
    return NextResponse.json({ error: "toiletId must be a number" }, { status: 400 });
  }
  if (id <= 0n) {
    return NextResponse.json({ error: "No such toilet" }, { status: 400 });
  }

  const age = Math.floor(Date.now() / 1000) - signedAt;
  if (!Number.isFinite(age) || age < -60 || age > SIGNATURE_TTL_SECONDS) {
    return NextResponse.json({ error: "Signature has expired — please sign again" }, { status: 400 });
  }

  const payload = encodeRatingPayload(observations);
  // An empty payload would spend gas and earn weight for saying nothing.
  if (payload === "{}") {
    return NextResponse.json({ error: "Nothing to add — fill in at least one thing" }, { status: 400 });
  }

  const limit = rateLimit(`rate:${rater.toLowerCase()}`, MAX_PER_ADDRESS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Too many ratings from this address. Retry in ${limit.retryAfter}s.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const valid = await verifyTypedData({
    address: rater,
    domain: CONTRIBUTION_DOMAIN,
    types: RATING_TYPES,
    primaryType: "Rating",
    message: { rater, toiletId: id, payload, signedAt: BigInt(signedAt) },
    signature,
  });
  if (!valid) {
    return NextResponse.json({ error: "Signature does not match rater" }, { status: 401 });
  }

  try {
    const hash = await relayRating({ toiletId: id, rater, payload });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction reverted", hash }, { status: 502 });
    }
    return NextResponse.json({ hash, blockNumber: Number(receipt.blockNumber), weight: 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relay failed";
    return NextResponse.json(
      {
        error: /insufficient funds/i.test(message)
          ? "The relayer wallet is out of Base Sepolia ETH — top it up and try again."
          : message.split("\n")[0],
      },
      { status: 502 },
    );
  }
}
