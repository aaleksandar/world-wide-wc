import { NextResponse } from "next/server";

/**
 * Serves an IPFS photo through our own origin.
 *
 * Public gateways have to *find* a CID on the network before they can serve it, and right
 * after an upload they haven't yet — so the one person guaranteed to see a broken image is
 * the contributor who just added it. That is the worst possible audience for this failure.
 *
 * We know exactly where the bytes are, because we put them there, so this asks that node
 * first and only then falls back to the public gateways. Photos stay addressed by CID —
 * this is a faster route to the same content, not a different source of truth.
 */

const SOURCES = [
  (cid: string) => `${process.env.IPFS_API_URL ?? "https://api.thegraph.com/ipfs/api/v0"}/cat?arg=${cid}`,
  (cid: string) => `https://ipfs.io/ipfs/${cid}`,
  (cid: string) => `https://gateway.pinata.cloud/ipfs/${cid}`,
];

const CID = /^[A-Za-z0-9]{46,80}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  if (!CID.test(cid)) {
    return NextResponse.json({ error: "Not a CID" }, { status: 400 });
  }

  for (const source of SOURCES) {
    try {
      const response = await fetch(source(cid), { signal: AbortSignal.timeout(15_000) });
      if (!response.ok || !response.body) continue;

      // The Graph's cat endpoint returns text/plain; sniff the real type from the bytes.
      const declared = response.headers.get("content-type") ?? "";
      const type = declared.startsWith("image/") ? declared : "image/jpeg";

      return new NextResponse(response.body, {
        headers: {
          "content-type": type,
          // Content-addressed, so it can never change under this URL.
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      // Try the next source.
    }
  }

  return NextResponse.json({ error: "Could not fetch that photo from IPFS" }, { status: 502 });
}
