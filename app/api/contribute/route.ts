import { NextResponse } from "next/server";
import { verifyTypedData } from "viem";
import {
  CONTRIBUTION_DOMAIN,
  CONTRIBUTION_TYPES,
  SIGNATURE_TTL_SECONDS,
  type ContributeRequest,
} from "@/lib/contribution";
import { encodePayload } from "@/lib/payload";
import { toChainCoord } from "@/lib/chain";
import { publicClient, relayToiletLog } from "@/lib/relayer";

/**
 * Takes a signed contribution and puts it onchain at our expense.
 *
 * The signature is what makes the entry the contributor's rather than ours: they are the
 * address the contract credits, and the address rewards accrue to. We only pay the gas.
 */
export async function POST(request: Request) {
  let body: ContributeRequest;
  try {
    body = (await request.json()) as ContributeRequest;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { contributor, lat, lng, toilet, signedAt, signature } = body;
  if (!contributor || !signature || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json(
      { error: "contributor, lat, lng and signature are required" },
      { status: 400 },
    );
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Coordinates are off the planet" }, { status: 400 });
  }

  const age = Math.floor(Date.now() / 1000) - signedAt;
  if (!Number.isFinite(age) || age < -60 || age > SIGNATURE_TTL_SECONDS) {
    return NextResponse.json(
      { error: "Signature has expired — please sign again" },
      { status: 400 },
    );
  }

  // A contribution submitted here is a human standing in front of a toilet. The harvesting
  // agent has its own route and is the only thing allowed to claim agent provenance.
  const payload = encodePayload({ ...toilet, source: "human" });
  const chainLat = toChainCoord(lat);
  const chainLng = toChainCoord(lng);

  const valid = await verifyTypedData({
    address: contributor,
    domain: CONTRIBUTION_DOMAIN,
    types: CONTRIBUTION_TYPES,
    primaryType: "Contribution",
    message: {
      contributor,
      lat: chainLat,
      lng: chainLng,
      payload,
      signedAt: BigInt(signedAt),
    },
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
      isAgent: false,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      return NextResponse.json({ error: "Transaction reverted", hash }, { status: 502 });
    }
    return NextResponse.json({ hash, blockNumber: Number(receipt.blockNumber) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relay failed";
    // Out of gas on the relayer is the failure people will actually hit, so say so.
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
