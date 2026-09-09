/**
 * A transaction receipt does not mean the next read will see the transaction.
 *
 * sepolia.base.org sits behind a pool of nodes, and a read issued straight after a
 * receipt is regularly answered by one that is a block or two behind. It has produced a
 * seeder that reported three toilets when six were onchain, a payout that looked short by
 * exactly one transaction's gas, a gas estimate that failed with "gas required exceeds
 * allowance (0)" against a funded wallet, and a weight of 3 where 6 was correct. Every
 * one of those looked like a contract bug and none of them were.
 *
 * Pinning reads to the receipt's block number doesn't help either — the public endpoint
 * is not an archive node and answers "block not found". So: poll until the world catches
 * up with what we already know happened.
 */
const DEFAULT_ATTEMPTS = 20;
const DEFAULT_INTERVAL_MS = 1500;

export async function readUntil<T>(
  read: () => Promise<T>,
  settled: (value: T) => boolean,
  { attempts = DEFAULT_ATTEMPTS, intervalMs = DEFAULT_INTERVAL_MS, label = "value" } = {},
): Promise<T> {
  let last: T | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await read();
    if (settled(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `${label} never settled after ${attempts} attempts (last saw ${String(last)}). ` +
      "The transaction may still be propagating.",
  );
}

/** The common case: wait for a number to reach at least `target`. */
export const readUntilAtLeast = (
  read: () => Promise<bigint>,
  target: bigint,
  label = "value",
) => readUntil(read, (value) => value >= target, { label });
