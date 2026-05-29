import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

describe('@adyton/shared harness', () => {
  it('exports VERSION === "0.0.0"', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('VERSION is a string', () => {
    expect(typeof VERSION).toBe('string');
  });
});
