interface Bucket { timestamps: number[] }
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export function rateLimit(opts: { limit: number; windowSec: number; key: string }): boolean {
  const now = Date.now();
  const windowMs = opts.windowSec * 1000;
  let bucket = buckets.get(opts.key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(opts.key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= opts.limit) return false;
  bucket.timestamps.push(now);
  if (buckets.size > MAX_BUCKETS) {
    for (const [key, candidate] of buckets) {
      if (candidate.timestamps.length === 0) buckets.delete(key);
    }
  }
  return true;
}

// Cloudflare's binding provides a shared edge-level guard; the local window
// remains useful for tests and as a tighter per-isolate burst guard.
export async function enforceRateLimit(
  binding: RateLimitBinding | undefined,
  opts: { limit: number; windowSec: number; key: string },
): Promise<boolean> {
  if (binding) {
    const result = await binding.limit({ key: opts.key });
    if (!result.success) return false;
  }
  return rateLimit(opts);
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
