import { chain, contractAddress } from "./chain";
import type { Toilet } from "./payload";

/**
 * The message a contributor signs.
 *
 * Contributors don't pay gas — they sign this, the server checks the signature, and the
 * relayer wallet pays to put it onchain. Signing is free and needs no ETH, which is the
 * difference between "add a toilet" and "add a toilet, but first go find a faucet".
 *
 * v1 verifies the signature offchain. That means trusting our server not to invent
 * contributions, which is a real limitation and is written down in the README. The fix is
 * to move this exact struct into the contract as EIP-712 with an onchain nonce; the
 * struct is shaped for that move already.
 */

export const CONTRIBUTION_DOMAIN = {
  name: "World Wide WC",
  version: "1",
  chainId: chain.id,
  verifyingContract: contractAddress,
} as const;

export const CONTRIBUTION_TYPES = {
  Contribution: [
    { name: "contributor", type: "address" },
    { name: "lat", type: "int32" },
    { name: "lng", type: "int32" },
    { name: "payload", type: "string" },
    { name: "signedAt", type: "uint256" },
  ],
} as const;

export const RATING_TYPES = {
  Rating: [
    { name: "rater", type: "address" },
    { name: "toiletId", type: "uint256" },
    { name: "payload", type: "string" },
    { name: "signedAt", type: "uint256" },
  ],
} as const;

/** A signature older than this is refused, which bounds how long a leaked one is useful. */
export const SIGNATURE_TTL_SECONDS = 300;

export type ContributionMessage = {
  contributor: `0x${string}`;
  lat: number;
  lng: number;
  payload: string;
  signedAt: bigint;
};

export type ContributeRequest = {
  contributor: `0x${string}`;
  lat: number;
  lng: number;
  toilet: Partial<Toilet>;
  signedAt: number;
  signature: `0x${string}`;
};
