import { describe, it, expect } from 'vitest';
import { parsePakUrl } from '../../app/utils/pak-url';

function payload(fields: Record<string, unknown>): string {
  return btoa(JSON.stringify(fields));
}

describe('parsePakUrl', () => {
  it('routes to /pak/enroll when the payload mode is "enroll"', () => {
    const d = payload({ m: 'enroll' });
    expect(parsePakUrl(`adyton://pak?d=${d}`)).toEqual({ path: '/pak/enroll', query: { d } });
  });

  it('routes to /pak/approve when the payload mode is anything else', () => {
    const d = payload({ m: 'unlock' });
    expect(parsePakUrl(`adyton://pak?d=${d}`)).toEqual({ path: '/pak/approve', query: { d } });
  });

  it('routes to /pak/approve when the payload has no mode field', () => {
    const d = payload({ foo: 'bar' });
    expect(parsePakUrl(`adyton://pak?d=${d}`)).toEqual({ path: '/pak/approve', query: { d } });
  });

  it('routes to /pak/approve when the payload is malformed JSON (peek fails, still has a d param)', () => {
    const d = btoa('not-json');
    expect(parsePakUrl(`adyton://pak?d=${d}`)).toEqual({ path: '/pak/approve', query: { d } });
  });

  it('returns null for a non-adyton scheme', () => {
    expect(parsePakUrl('https://example.com/pak?d=abc')).toBeNull();
  });

  it('returns null for an adyton URL with a different host', () => {
    expect(parsePakUrl('adyton://other?d=abc')).toBeNull();
  });

  it('returns null when the d query param is missing', () => {
    expect(parsePakUrl('adyton://pak?x=1')).toBeNull();
  });

  it('routes to /pak/approve (not null) when d is not valid base64', () => {
    // atob() throws on malformed base64 — caught by the mode-peek, not surfaced as
    // null. The destination page does the real validation and shows the error.
    const d = '%25%25%25'; // decodes to the literal string "%%%", not valid base64
    expect(parsePakUrl(`adyton://pak?d=${d}`)).toEqual({ path: '/pak/approve', query: { d: '%%%' } });
  });

  it('returns null for an unparseable URL', () => {
    // A space in the host segment is a forbidden host code point — new URL() throws.
    expect(parsePakUrl('adyton://pak invalid?d=abc')).toBeNull();
  });
});
