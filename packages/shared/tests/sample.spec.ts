import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

describe('@adyton/shared harness', () => {
  it('exports VERSION string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it('VERSION is a string', () => {
    expect(typeof VERSION).toBe('string');
  });
});
