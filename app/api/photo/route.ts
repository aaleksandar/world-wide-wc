import { NextResponse } from "next/server";
import { addToIpfs, pinRemotely } from "@/lib/ipfs";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

/**
 * Photos go to IPFS and only the `ipfs://` URI goes onchain.
 *
 * Storing the bytes onchain would be absurd; storing a hash with no way to fetch the
 * bytes would be useless to anyone reading the map. A CID is both — it names the photo
 * and proves it hasn't been swapped.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No photo in the request" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Photo is larger than 8MB" }, { status: 413 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type ${file.type}` }, { status: 415 });
  }

  try {
    const { cid, uri } = await addToIpfs(file, file.name || "toilet");
    const pinned = await pinRemotely(cid);
    return NextResponse.json({ url: uri, cid, pinned });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 502 },
    );
  }
}
