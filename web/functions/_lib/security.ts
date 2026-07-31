interface Bucket { timestamps: number[] }
const buckets = new Map<string, Bucket>();

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
  return true;
}

export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
