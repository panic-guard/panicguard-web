// A simple in-memory sliding-window limiter — adequate for a single Cloud
// Run instance; if this ever scales to multiple instances, move the counts
// to something shared (e.g. Firestore/Redis) instead.
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

const hits = new Map<string, number[]>();

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hits.set(key, timestamps);
  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}

// Periodically forget keys with no recent activity so this doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of hits) {
    if (timestamps.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
  }
}, WINDOW_MS).unref();
