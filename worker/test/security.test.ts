import { describe, it, expect } from 'vitest';
import { rateLimit } from '../src/security';

describe('rateLimit', () => {
  it('前 N 次放行，第 N+1 次拒绝', () => {
    const key = 'test-key-1';
    for (let i = 0; i < 5; i++) {
      expect(rateLimit({ limit: 5, windowSec: 900, key })).toBe(true);
    }
    expect(rateLimit({ limit: 5, windowSec: 900, key })).toBe(false);
  });

  it('不同 key 互不影响', () => {
    expect(rateLimit({ limit: 1, windowSec: 900, key: 'test-key-2a' })).toBe(true);
    expect(rateLimit({ limit: 1, windowSec: 900, key: 'test-key-2b' })).toBe(true);
  });
});
