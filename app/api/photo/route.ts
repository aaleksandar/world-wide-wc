import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

/**
 * Photos go to Vercel Blob and only the URL goes onchain. Storing the image itself onchain
 * would be absurd; storing a hash without the bytes would be useless to anyone looking at
 * the map.
 */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Photo storage isn't configured — you can still submit without one." },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No photo in the request" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Photo is larger than 8MB" }, { status: 413 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type ${file.type}` }, { status: 415 });
  }

  const blob = await put(`toilets/${crypto.randomUUID()}`, file, {
    access: "public",
    contentType: file.type,
    addRandomSuffix: false,
  });

  return NextResponse.json({ url: blob.url });
}
