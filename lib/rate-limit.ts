/**
 * A crude per-key rate limit for the relayed contribution endpoint.
 *
 * That endpoint spends our gas on someone else's behalf, so it needs some brake. This one
 * is in-process and therefore per-instance: it resets on deploy and doesn't coordinate
 * across regions. Good enough to stop a loop from draining the relayer wallet, not a
 * defence against someone who means it. An agent that wants no limits should call the
 * contract directly and pay its own gas — which is the point of `log()` existing.
 */
const WINDOW_MS = 60_000;

const hits = new Map<string, number[]>();

export function rateLimit(key: string, max: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);

  if (recent.length >= max) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    hits.set(key, recent);
    return { ok: false, retryAfter };
  }

  recent.push(now);
  hits.set(key, recent);

  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5_000) {
    for (const [existing, times] of hits) {
      if (times.every((at) => now - at >= WINDOW_MS)) hits.delete(existing);
    }
  }

  return { ok: true, retryAfter: 0 };
}
