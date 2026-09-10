/**
 * Photos live on IPFS.
 *
 * Not on The Graph — that indexes events, it doesn't store files — but IPFS is the same
 * neighbourhood: it is where subgraph manifests live, and `graph-cli` ships a client for
 * it. It suits this project better than ordinary object storage for a reason beyond
 * convenience: a CID is a hash of the bytes, so the photo attached to a toilet cannot be
 * quietly swapped for a different one later. The provenance argument that applies to the
 * data applies to the pictures too.
 *
 * What goes onchain is `ipfs://<cid>`, never a gateway URL. Gateways come and go; the CID
 * is the durable name, and readers can fetch it through whichever gateway they trust.
 */

/** Where we add files. The Graph's node by default; any IPFS API works. */
const ADD_ENDPOINT = process.env.IPFS_API_URL ?? "https://api.thegraph.com/ipfs/api/v0";

/** Where the browser reads them back from. */
export const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://ipfs.io/ipfs";

export type IpfsUpload = { cid: string; uri: string };

export async function addToIpfs(file: File | Blob, filename: string): Promise<IpfsUpload> {
  const form = new FormData();
  form.append("file", file, filename);

  const response = await fetch(`${ADD_ENDPOINT}/add?pin=true`, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`IPFS add failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { Hash?: string };
  if (!body.Hash) throw new Error("IPFS returned no CID");

  return { cid: body.Hash, uri: `ipfs://${body.Hash}` };
}

/**
 * Also pin to Pinata when a token is configured.
 *
 * The Graph's IPFS node is meant for subgraph manifests, and nothing promises it will
 * keep a stranger's photo indefinitely — unpinned content can be garbage-collected. A
 * second pin is what makes a photo outlive the demo. Best-effort on purpose: a pinning
 * failure should never lose someone's contribution.
 */
export async function pinRemotely(cid: string): Promise<boolean> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return false;

  try {
    const response = await fetch("https://api.pinata.cloud/pinning/pinByHash", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ hashToPin: cid }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** `ipfs://Qm…` → a URL a browser can load. Leaves http(s) URLs alone. */
export function ipfsToHttp(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return `${IPFS_GATEWAY}/${uri.slice("ipfs://".length)}`;
  return uri;
}
