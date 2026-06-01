// argon2-browser's UMD wrapper uses `typeof self !== 'undefined' ? self : this`
// to find the global. In Node.js ESM, `this` at top-level is `undefined`.
// Polyfill `self` so the UMD code finds the global object correctly.
if (typeof self === 'undefined') {
  (globalThis as Record<string, unknown>).self = globalThis;
}
